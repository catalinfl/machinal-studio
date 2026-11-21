package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"ffmpeg-go-server/internal/integrations/paypal"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/credits"
)

type Pack struct {
	ID      string `json:"id"`
	Credits int64  `json:"credits"`
	USD     string `json:"usd"`
}

type MembershipPlan struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Days    int    `json:"days"`
	Credits int64  `json:"credits"`
	USD     string `json:"usd"`
}

var moneyPattern = regexp.MustCompile(`^[1-9][0-9]{0,5}\.[0-9]{2}$|^0\.[0-9]{2}$`)
var orderIDPattern = regexp.MustCompile(`^[A-Za-z0-9]{5,64}$`)

type Handler struct {
	Store           *credits.Store
	Pricing         credits.Pricing
	PayPal          *paypal.Client
	AppURL          string
	Packs           []Pack
	MembershipPlans []MembershipPlan
	paid            func(context.Context, string) (bool, error)
}

func New(store *credits.Store) (*Handler, error) {
	handler := &Handler{Store: store, Pricing: credits.PricingFromEnv(), Packs: []Pack{}}
	handler.paid = auth.CurrentPaidAccess
	if raw := strings.TrimSpace(os.Getenv("MEMBERSHIP_PLANS_JSON")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &handler.MembershipPlans); err != nil {
			return nil, fmt.Errorf("invalid MEMBERSHIP_PLANS_JSON: %w", err)
		}
		seen := map[string]bool{}
		for _, plan := range handler.MembershipPlans {
			if plan.ID == "" || len(plan.ID) > 60 || seen[plan.ID] || strings.TrimSpace(plan.Name) == "" || len(plan.Name) > 80 || plan.Days < 1 || plan.Days > 366 || plan.Credits < 0 || plan.Credits > 1_000_000 || !moneyPattern.MatchString(plan.USD) || plan.USD == "0.00" {
				return nil, fmt.Errorf("invalid membership plan configuration")
			}
			seen[plan.ID] = true
		}
	}
	if raw := strings.TrimSpace(os.Getenv("CREDIT_PACKS_JSON")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &handler.Packs); err != nil {
			return nil, fmt.Errorf("invalid CREDIT_PACKS_JSON: %w", err)
		}
		seen := map[string]bool{}
		for _, pack := range handler.Packs {
			if pack.ID == "" || len(pack.ID) > 60 || seen[pack.ID] || pack.Credits <= 0 || pack.Credits > 1_000_000 || !moneyPattern.MatchString(pack.USD) || pack.USD == "0.00" {
				return nil, fmt.Errorf("invalid credit pack configuration")
			}
			seen[pack.ID] = true
		}
	}
	clientID, secret := paypalSetting("PAYPAL_CLIENT_ID"), paypalSetting("PAYPAL_CLIENT_SECRET")
	if clientID == "" || secret == "" {
		return handler, nil
	}
	base := "https://api-m.sandbox.paypal.com"
	mode := paypalSetting("PAYPAL_MODE")
	if mode == "live" {
		base = "https://api-m.paypal.com"
	} else if mode != "" && mode != "sandbox" {
		return nil, fmt.Errorf("PAYPAL_MODE must be sandbox or live")
	}
	app, err := url.Parse(strings.TrimSpace(os.Getenv("PUBLIC_APP_URL")))
	if err != nil || app.Host == "" || app.User != nil || app.RawQuery != "" || app.Fragment != "" ||
		(app.Scheme != "https" && !(mode != "live" && app.Scheme == "http" && (app.Hostname() == "localhost" || app.Hostname() == "127.0.0.1"))) {
		return nil, fmt.Errorf("PUBLIC_APP_URL must be a trusted application origin")
	}
	handler.AppURL = strings.TrimRight(app.String(), "/")
	handler.PayPal = &paypal.Client{BaseURL: base, ClientID: clientID, Secret: secret,
		WebhookID: paypalSetting("PAYPAL_WEBHOOK_ID"), HTTP: &http.Client{Timeout: 20 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	return handler, nil
}

func paypalSetting(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "-" {
		return ""
	}
	return value
}

func (h *Handler) purchasesAvailable() bool {
	return h.PayPal != nil && h.PayPal.WebhookID != "" && len(h.Packs) > 0 && h.Pricing.Validate() == nil
}

func (h *Handler) membershipsAvailable() bool {
	return h.PayPal != nil && h.PayPal.WebhookID != "" && len(h.MembershipPlans) > 0
}

func (h *Handler) paymentMode() string {
	if h.PayPal == nil {
		return "unavailable"
	}
	if h.PayPal.BaseURL == "https://api-m.paypal.com" {
		return "live"
	}
	return "sandbox"
}
