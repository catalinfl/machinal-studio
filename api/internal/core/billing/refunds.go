package billing

import (
	"encoding/json"
	"errors"
	"math/big"
	"net/url"
	"strings"

	"ffmpeg-go-server/internal/integrations/paypal"
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) reversePayment(eventType string, raw json.RawMessage) error {
	var resource struct {
		ID     string        `json:"id"`
		Amount paypal.Amount `json:"amount"`
		Links  []struct {
			Href string `json:"href"`
			Rel  string `json:"rel"`
		} `json:"links"`
	}
	if err := json.Unmarshal(raw, &resource); err != nil {
		return fiber.ErrBadRequest
	}
	if !orderIDPattern.MatchString(resource.ID) {
		return fiber.ErrBadRequest
	}
	captureID := resource.ID
	if eventType == "PAYMENT.CAPTURE.REFUNDED" {
		captureID = ""
		for _, link := range resource.Links {
			parsed, err := url.Parse(link.Href)
			if err == nil && link.Rel == "up" && parsed.Scheme == "https" &&
				(parsed.Host == "api.paypal.com" || parsed.Host == "api.sandbox.paypal.com" || parsed.Host == "api-m.paypal.com" || parsed.Host == "api-m.sandbox.paypal.com") {
				captureID = strings.TrimPrefix(parsed.Path, "/v2/payments/captures/")
			}
		}
	}
	if !orderIDPattern.MatchString(captureID) {
		return fiber.ErrBadRequest
	}
	order, err := h.Store.CapturedOrder(captureID)
	if errors.Is(err, credits.ErrNotFound) {
		return h.Store.BlockCapture(captureID)
	}
	if err != nil {
		return err
	}
	units := order.Credits * credits.UnitsPerCredit
	if eventType == "PAYMENT.CAPTURE.REFUNDED" {
		refund, ok := new(big.Rat).SetString(resource.Amount.Value)
		paid, valid := new(big.Rat).SetString(order.USD)
		if !ok || !valid || resource.Amount.Currency != "USD" || refund.Sign() <= 0 || refund.Cmp(paid) > 0 {
			return fiber.ErrBadRequest
		}
		ratio := refund.Quo(refund, paid).Mul(refund, big.NewRat(units, 1))
		value, remainder := new(big.Int), new(big.Int)
		value.QuoRem(ratio.Num(), ratio.Denom(), remainder)
		if remainder.Sign() > 0 {
			value.Add(value, big.NewInt(1))
		}
		units = value.Int64()
	}
	return h.Store.ReverseCapture(captureID, eventType+":"+resource.ID, units)
}
