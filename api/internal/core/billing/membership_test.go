package billing

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/paypal"
	"ffmpeg-go-server/internal/platform/credits"
)

func TestFreeAccountCanBuyOnlyServerConfiguredMembership(t *testing.T) {
	h, app := billingFixture(t)
	h.paid = func(context.Context, string) (bool, error) { return false, nil }
	h.MembershipPlans = []MembershipPlan{{ID: "creator", Name: "Creator", Days: 30, USD: "10.00"}}
	app.Post("/membership", h.CreateMembershipOrder)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/oauth2/token" {
			io.WriteString(w, `{"access_token":"test","expires_in":3600}`)
			return
		}
		calls++
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		units := body["purchase_units"].([]any)
		if units[0].(map[string]any)["amount"].(map[string]any)["value"] != "10.00" {
			t.Error("membership price came from client")
		}
		io.WriteString(w, `{"id":"ORDER123","links":[{"rel":"payer-action","href":"https://www.sandbox.paypal.com/checkoutnow?token=ORDER123"}]}`)
	}))
	defer server.Close()
	h.PayPal = &paypal.Client{BaseURL: server.URL, HTTP: server.Client(), WebhookID: "verified-webhook"}
	for _, item := range []struct {
		body   string
		status int
	}{
		{`{"planId":"creator","usd":"0.01"}`, 400}, {`{"planId":"missing"}`, 400}, {`{"planId":"creator"}`, 201},
	} {
		response, err := app.Test(httptest.NewRequest("POST", "/membership", strings.NewReader(item.body)))
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != item.status {
			t.Fatal(item.body, response.StatusCode)
		}
	}
	if calls != 1 {
		t.Fatal("invalid checkout contacted PayPal", calls)
	}
	snapshot, err := h.Store.Order("ORDER123")
	if err != nil || snapshot.MembershipDays != 30 || snapshot.Owner != "alice" || snapshot.USD != "10.00" {
		t.Fatal(snapshot, err)
	}
	if member, err := h.Store.Membership("alice"); err != nil || member.Active {
		t.Fatal("unpaid approval granted membership", member, err)
	}
}

func TestMembershipOnlyRefundRevokesAccessAndHistoryHidesPrivateFields(t *testing.T) {
	h, app := billingFixture(t)
	app.Get("/history", h.Orders)
	app.Post("/orders/:orderID/refund-request", h.RequestRefund)
	order := credits.Order{ID: "ORDER123", Owner: "alice", Reference: "private-reference", PackID: "creator", PlanName: "Creator", MembershipDays: 30, USD: "10.00"}
	if err := h.Store.SaveOrder(order); err != nil {
		t.Fatal(err)
	}
	if err := h.completeOrder(order, providerOrder(t, order.Reference, "COMPLETED", order.USD)); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/orders/ORDER123/refund-request", strings.NewReader(`{"reason":"Please review this purchase"}`))
	request.Header.Set("X-Test-Owner", "bob")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("another owner requested refund", response.StatusCode)
	}
	response, err = app.Test(httptest.NewRequest("GET", "/history", nil))
	if err != nil {
		t.Fatal(err)
	}
	data, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if strings.Contains(string(data), "private-reference") || strings.Contains(string(data), "CAPTURE123") || strings.Contains(string(data), `"owner"`) {
		t.Fatal("private ledger fields leaked", string(data))
	}
	refund := json.RawMessage(`{"id":"REFUND123","amount":{"currency_code":"USD","value":"10.00"},"links":[{"rel":"up","href":"https://api.paypal.com/v2/payments/captures/CAPTURE123"}]}`)
	if err := h.reversePayment("PAYMENT.CAPTURE.REFUNDED", refund); err != nil {
		t.Fatal(err)
	}
	if member, err := h.Store.Membership("alice"); err != nil || member.Active {
		t.Fatal("refund retained membership", member, err)
	}
}
