package billing

import "testing"

func TestPayPalPlaceholderCredentialsDisableCheckout(t *testing.T) {
	for _, credentials := range []struct {
		name, clientID, secret string
	}{
		{"all placeholders", "-", "-"},
		{"placeholder client ID", " - ", "test-secret"},
		{"placeholder secret", "test-client", " - "},
		{"missing client ID", "", "test-secret"},
		{"missing secret", "test-client", ""},
	} {
		t.Run(credentials.name, func(t *testing.T) {
			t.Setenv("PAYPAL_CLIENT_ID", credentials.clientID)
			t.Setenv("PAYPAL_CLIENT_SECRET", credentials.secret)
			t.Setenv("PAYPAL_MODE", "-")
			t.Setenv("PAYPAL_WEBHOOK_ID", "-")
			t.Setenv("MEMBERSHIP_PLANS_JSON", "[]")
			t.Setenv("CREDIT_PACKS_JSON", "[]")
			handler, err := New(nil)
			if err != nil {
				t.Fatal(err)
			}
			if handler.PayPal != nil || handler.purchasesAvailable() || handler.membershipsAvailable() {
				t.Fatal("placeholder credentials enabled PayPal")
			}
		})
	}
}

func TestPayPalPlaceholderWebhookKeepsCheckoutDisabled(t *testing.T) {
	t.Setenv("PAYPAL_CLIENT_ID", "test-client")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_MODE", "-")
	t.Setenv("PAYPAL_WEBHOOK_ID", " - ")
	t.Setenv("PUBLIC_APP_URL", "https://app.example.test")
	t.Setenv("CREDIT_USD_VALUE", "0.01")
	t.Setenv("CREDIT_RENDER_PER_MINUTE", "1")
	t.Setenv("CREDIT_PACKS_JSON", `[{"id":"test","credits":10,"usd":"1.00"}]`)
	t.Setenv("MEMBERSHIP_PLANS_JSON", `[{"id":"test","name":"Test","days":30,"credits":10,"usd":"1.00"}]`)
	handler, err := New(nil)
	if err != nil {
		t.Fatal(err)
	}
	if handler.PayPal == nil || handler.PayPal.BaseURL != "https://api-m.sandbox.paypal.com" {
		t.Fatal("unset PayPal mode did not default to sandbox")
	}
	if handler.PayPal.WebhookID != "" || handler.purchasesAvailable() || handler.membershipsAvailable() {
		t.Fatal("placeholder webhook enabled checkout")
	}
}

func TestPayPalInvalidConfiguredModeStillFails(t *testing.T) {
	t.Setenv("PAYPAL_CLIENT_ID", "test-client")
	t.Setenv("PAYPAL_CLIENT_SECRET", "test-secret")
	t.Setenv("PAYPAL_MODE", "invalid")
	t.Setenv("MEMBERSHIP_PLANS_JSON", "[]")
	t.Setenv("CREDIT_PACKS_JSON", "[]")
	if _, err := New(nil); err == nil {
		t.Fatal("invalid configured PayPal mode was accepted")
	}
}
