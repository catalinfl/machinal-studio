package billing

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ffmpeg-go-server/internal/integrations/paypal"
)

func TestPublicCatalogContainsCheckoutPricesWithoutAccountOrPrivatePricing(t *testing.T) {
	h, app := billingFixture(t)
	h.PayPal = &paypal.Client{BaseURL: "https://api-m.sandbox.paypal.com", ClientID: "private-client", Secret: "private-secret", WebhookID: "private-webhook"}
	h.MembershipPlans = []MembershipPlan{{ID: "pro-30", Name: "Pro", Days: 30, USD: "10.00"}}
	app.Get("/catalog", h.Catalog)
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/catalog", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"private-", "balance", "membership\"", "owner", "budgetPercent", "aiPricing"} {
		if strings.Contains(string(data), private) {
			t.Fatalf("public catalog exposed %q", private)
		}
	}
	var catalog struct {
		Memberships struct {
			Plans           []MembershipPlan `json:"plans"`
			IncludedCredits int              `json:"includedCredits"`
			AllowanceDays   int              `json:"allowanceDays"`
		} `json:"memberships"`
		Purchase struct{ Packs []Pack } `json:"purchase"`
		Payments struct{ Mode string }  `json:"payments"`
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || response.Header.Get("Cache-Control") != "no-store" ||
		len(catalog.Memberships.Plans) != 1 || catalog.Memberships.Plans[0].USD != "10.00" ||
		catalog.Memberships.IncludedCredits != 1000 || catalog.Memberships.AllowanceDays != 30 ||
		len(catalog.Purchase.Packs) != 1 || catalog.Payments.Mode != "sandbox" {
		t.Fatalf("unexpected public catalog: %s", data)
	}
}
