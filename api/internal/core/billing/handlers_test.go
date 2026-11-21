package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ffmpeg-go-server/internal/integrations/paypal"
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

func billingFixture(t *testing.T) (*Handler, *fiber.App) {
	t.Helper()
	store, err := credits.Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	h := &Handler{Store: store, Pricing: credits.Pricing{USDPerCredit: "0.01", RenderPerMinute: "2"},
		Packs: []Pack{{ID: "pack", Credits: 250, USD: "2.50"}}, AppURL: "https://app.example.test",
		paid: func(context.Context, string) (bool, error) { return true, nil }}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		owner := c.Get("X-Test-Owner", "alice")
		c.Locals("pbUserId", owner)
		return c.Next()
	})
	app.Get("/credits", h.Summary)
	app.Post("/orders", h.CreateOrder)
	app.Post("/orders/:orderID/capture", h.CaptureOrder)
	app.Post("/webhook", h.Webhook)
	return h, app
}

func TestSummaryExposesOnlyCustomerFacingCreditRates(t *testing.T) {
	_, app := billingFixture(t)
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/credits", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var summary struct {
		Pricing    map[string]any `json:"pricing"`
		MCPPricing map[string]any `json:"mcpPricing"`
	}
	if err := json.NewDecoder(response.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || len(summary.Pricing) != 3 || summary.Pricing["configured"] != true || summary.Pricing["usdPerCredit"] != "0.01" || summary.Pricing["renderPerMinute"] != "2" {
		t.Fatalf("summary changed public rates or exposed internal AI pricing: %+v", summary.Pricing)
	}
	if summary.MCPPricing["speechMinimumCredits"] != float64(1) || summary.MCPPricing["transcriptionMinimumCredits"] != float64(1) {
		t.Fatal("REST did not expose the audio minimums", summary.MCPPricing)
	}
}

func savedOrder(t *testing.T, h *Handler) credits.Order {
	t.Helper()
	order := credits.Order{ID: "ORDER123", Owner: "alice", Reference: "ref-alice", PackID: "pack", Credits: 250, USD: "2.50"}
	if err := h.Store.SaveOrder(order); err != nil {
		t.Fatal(err)
	}
	return order
}

func providerOrder(t *testing.T, ref, status, amount string) paypal.Order {
	t.Helper()
	var order paypal.Order
	raw := fmt.Sprintf(`{"id":"ORDER123","intent":"CAPTURE","status":%q,"purchase_units":[{"custom_id":%q,"amount":{"currency_code":"USD","value":%q},"payments":{"captures":[{"id":"CAPTURE123","status":"COMPLETED","amount":{"currency_code":"USD","value":%q}}]}}]}`, status, ref, amount, amount)
	if err := json.Unmarshal([]byte(raw), &order); err != nil {
		t.Fatal(err)
	}
	return order
}

func TestVerifiedPaymentIsIdempotentAndRejectsMismatchedAmountOrAccount(t *testing.T) {
	h, _ := billingFixture(t)
	snapshot := savedOrder(t, h)
	for _, value := range []paypal.Order{providerOrder(t, "ref-alice", "APPROVED", "2.50"), providerOrder(t, "ref-bob", "COMPLETED", "2.50"), providerOrder(t, "ref-alice", "COMPLETED", "0.01")} {
		if err := h.completeOrder(snapshot, value); err == nil {
			t.Fatal("unverified payment granted credits")
		}
	}
	valid := providerOrder(t, "ref-alice", "COMPLETED", "2.50")
	for i := 0; i < 3; i++ {
		if err := h.completeOrder(snapshot, valid); err != nil {
			t.Fatal(err)
		}
	}
	balance, err := h.Store.Balance("alice", true)
	if err != nil || balance.PurchasedRemaining != 250 {
		t.Fatalf("duplicate grant: %+v %v", balance, err)
	}
}

func TestCaptureDoesNotContactPayPalForAnotherUsersOrder(t *testing.T) {
	h, app := billingFixture(t)
	savedOrder(t, h)
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("ownership check happened after contacting PayPal") }))
	defer server.Close()
	h.PayPal = &paypal.Client{BaseURL: server.URL, HTTP: server.Client()}
	request := httptest.NewRequest(http.MethodPost, "/orders/ORDER123/capture", nil)
	request.Header.Set("X-Test-Owner", "bob")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal(response.StatusCode)
	}
}

func TestCheckoutTakesPriceOnlyFromServerAndFreeAccountsCannotBuy(t *testing.T) {
	h, app := billingFixture(t)
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/oauth2/token" {
			io.WriteString(w, `{"access_token":"test","expires_in":3600}`)
			return
		}
		calls++
		var input struct {
			Units []struct {
				Amount paypal.Amount `json:"amount"`
			} `json:"purchase_units"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if len(input.Units) != 1 || input.Units[0].Amount.Value != "2.50" {
			t.Error("client altered the amount")
		}
		io.WriteString(w, `{"id":"ORDER123","links":[{"rel":"payer-action","href":"https://www.sandbox.paypal.com/checkoutnow?token=ORDER123"}]}`)
	}))
	defer server.Close()
	h.PayPal = &paypal.Client{BaseURL: server.URL, HTTP: server.Client(), WebhookID: "webhook", ClientID: "id", Secret: "secret"}
	for _, test := range []struct {
		body   string
		status int
	}{{`{"packId":"pack","usd":"0.01"}`, 400}, {`{"packId":"unknown"}`, 400}, {`{"packId":"pack"}`, 201}} {
		request := httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader(test.body))
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != test.status {
			t.Fatalf("%s: %d", test.body, response.StatusCode)
		}
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	h.paid = func(context.Context, string) (bool, error) { return false, nil }
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader(`{"packId":"pack"}`)))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 402 || calls != 1 {
		t.Fatal("free account initiated checkout")
	}
}

func TestWebhookRequiresVerificationAndDoesNotGrantTwice(t *testing.T) {
	h, app := billingFixture(t)
	savedOrder(t, h)
	valid := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/oauth2/token":
			io.WriteString(w, `{"access_token":"test","expires_in":3600}`)
		case "/v1/notifications/verify-webhook-signature":
			if valid {
				io.WriteString(w, `{"verification_status":"SUCCESS"}`)
			} else {
				io.WriteString(w, `{"verification_status":"FAILURE"}`)
			}
		case "/v2/checkout/orders/ORDER123":
			json.NewEncoder(w).Encode(providerOrder(t, "ref-alice", "COMPLETED", "2.50"))
		default:
			t.Error(r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	h.PayPal = &paypal.Client{BaseURL: server.URL, HTTP: server.Client(), WebhookID: "webhook"}
	event := `{"event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"supplementary_data":{"related_ids":{"order_id":"ORDER123"}}}}`
	for i := 0; i < 3; i++ {
		response, err := app.Test(httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(event)))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		want := 204
		if !valid {
			want = 401
		}
		if response.StatusCode != want {
			t.Fatalf("webhook %d", response.StatusCode)
		}
		valid = true
	}
	balance, err := h.Store.Balance("alice", true)
	if err != nil || balance.PurchasedRemaining != 250 {
		t.Fatal(balance, err)
	}
}

func TestRefundRemovesPurchasedCreditsAndCannotConvertMonthlyCreditsToPermanent(t *testing.T) {
	h, _ := billingFixture(t)
	order := savedOrder(t, h)
	if err := h.completeOrder(order, providerOrder(t, "ref-alice", "COMPLETED", "2.50")); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Store.Balance("alice", true); err != nil {
		t.Fatal(err)
	}
	refund := json.RawMessage(`{"id":"REFUND123","amount":{"currency_code":"USD","value":"2.50"},"links":[{"rel":"up","href":"https://api.paypal.com/v2/payments/captures/CAPTURE123"}]}`)
	for i := 0; i < 2; i++ {
		if err := h.reversePayment("PAYMENT.CAPTURE.REFUNDED", refund); err != nil {
			t.Fatal(err)
		}
	}
	balance, err := h.Store.Balance("alice", true)
	if err != nil || balance.PurchasedRemaining != 0 || balance.MonthlyRemaining != 1000 {
		t.Fatalf("refund moved monthly funds: %+v %v", balance, err)
	}
}
