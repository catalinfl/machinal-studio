package paypal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const responseLimit = 1 << 20

type Client struct {
	BaseURL   string
	ClientID  string
	Secret    string
	WebhookID string
	HTTP      *http.Client
	mu        sync.Mutex
	token     string
	expires   time.Time
}

type Amount struct {
	Currency string `json:"currency_code"`
	Value    string `json:"value"`
}

type Capture struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Amount Amount `json:"amount"`
}

type Order struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Intent string `json:"intent"`
	Units  []struct {
		Reference string `json:"custom_id"`
		Amount    Amount `json:"amount"`
		Payments  struct {
			Captures []Capture `json:"captures"`
		} `json:"payments"`
	} `json:"purchase_units"`
	Links []struct {
		Href string `json:"href"`
		Rel  string `json:"rel"`
	} `json:"links"`
}

func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.expires) {
		return c.token, nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/v1/oauth2/token", strings.NewReader("grant_type=client_credentials"))
	if err != nil {
		return "", fmt.Errorf("build PayPal authentication: %w", err)
	}
	request.SetBasicAuth(c.ClientID, c.Secret)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var result struct {
		Token   string `json:"access_token"`
		Expires int    `json:"expires_in"`
	}
	if err := c.send(request, &result); err != nil {
		return "", err
	}
	if result.Token == "" || result.Expires < 1 {
		return "", fmt.Errorf("invalid PayPal authentication response")
	}
	c.token, c.expires = result.Token, time.Now().Add(time.Duration(result.Expires)*time.Second-time.Minute)
	return c.token, nil
}

func (c *Client) request(ctx context.Context, method, path, reference string, input, output any) error {
	token, err := c.accessToken(ctx)
	if err != nil {
		return err
	}
	var body []byte
	if input != nil {
		body, err = json.Marshal(input)
		if err != nil {
			return fmt.Errorf("encode PayPal request: %w", err)
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build PayPal request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	if reference != "" {
		req.Header.Set("PayPal-Request-Id", reference)
	}
	return c.send(req, output)
}

func (c *Client) send(request *http.Request, output any) error {
	response, err := c.HTTP.Do(request)
	if err != nil {
		return fmt.Errorf("request PayPal: %w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
	if err != nil {
		return fmt.Errorf("read PayPal response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("PayPal returned HTTP %d", response.StatusCode)
	}
	if len(data) > responseLimit {
		return fmt.Errorf("PayPal response exceeds limit")
	}
	if err := json.Unmarshal(data, output); err != nil {
		return fmt.Errorf("decode PayPal response: %w", err)
	}
	return nil
}

func (c *Client) Create(ctx context.Context, reference, usd, appURL string) (Order, error) {
	return c.CreateCheckout(ctx, reference, usd, appURL, "/api-keys")
}

func (c *Client) CreateCheckout(ctx context.Context, reference, usd, appURL, returnPath string) (Order, error) {
	var order Order
	if returnPath != "/api-keys" && returnPath != "/membership" { return order, fmt.Errorf("invalid checkout return path") }
	payload := map[string]any{
		"intent":         "CAPTURE",
		"purchase_units": []any{map[string]any{"custom_id": reference, "amount": Amount{Currency: "USD", Value: usd}}},
		"payment_source": map[string]any{"paypal": map[string]any{"experience_context": map[string]any{
			"shipping_preference": "NO_SHIPPING", "user_action": "PAY_NOW",
			"return_url": appURL + returnPath + "?paypal=approved", "cancel_url": appURL + returnPath + "?paypal=cancelled",
		}}},
	}
	err := c.request(ctx, http.MethodPost, "/v2/checkout/orders", reference+"-create", payload, &order)
	return order, err
}

func (c *Client) Get(ctx context.Context, id string) (Order, error) {
	var order Order
	err := c.request(ctx, http.MethodGet, "/v2/checkout/orders/"+url.PathEscape(id), "", nil, &order)
	return order, err
}

func (c *Client) Capture(ctx context.Context, id, reference string) (Order, error) {
	var order Order
	err := c.request(ctx, http.MethodPost, "/v2/checkout/orders/"+url.PathEscape(id)+"/capture", reference+"-capture", map[string]any{}, &order)
	if err == nil {
		return c.Get(ctx, id)
	}
	// A retry after a lost response must verify the existing capture, not charge twice.
	existing, lookupErr := c.Get(ctx, id)
	if lookupErr == nil && existing.Status == "COMPLETED" {
		return existing, nil
	}
	return order, err
}

func (c *Client) VerifyWebhook(ctx context.Context, headers http.Header, event json.RawMessage) error {
	if c.WebhookID == "" {
		return fmt.Errorf("PayPal webhook is not configured")
	}
	payload := map[string]any{"auth_algo": headers.Get("Paypal-Auth-Algo"), "cert_url": headers.Get("Paypal-Cert-Url"),
		"transmission_id": headers.Get("Paypal-Transmission-Id"), "transmission_sig": headers.Get("Paypal-Transmission-Sig"),
		"transmission_time": headers.Get("Paypal-Transmission-Time"), "webhook_id": c.WebhookID, "webhook_event": event}
	var result struct {
		Status string `json:"verification_status"`
	}
	if err := c.request(ctx, http.MethodPost, "/v1/notifications/verify-webhook-signature", "", payload, &result); err != nil {
		return err
	}
	if result.Status != "SUCCESS" {
		return fmt.Errorf("invalid PayPal webhook signature")
	}
	return nil
}

func (o Order) ApprovalURL() string {
	for _, link := range o.Links {
		if link.Rel != "payer-action" && link.Rel != "approve" {
			continue
		}
		parsed, err := url.Parse(link.Href)
		if err == nil && parsed.Scheme == "https" && parsed.User == nil && parsed.Port() == "" &&
			(parsed.Hostname() == "www.paypal.com" || parsed.Hostname() == "www.sandbox.paypal.com") {
			return link.Href
		}
	}
	return ""
}
