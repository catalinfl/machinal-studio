package billing

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	"ffmpeg-go-server/internal/integrations/openrouter"
	"ffmpeg-go-server/internal/integrations/paypal"
	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

const maxBillingBody = 4096

func (h *Handler) accountPaid(c *fiber.Ctx) (bool, error) {
	return h.paid(c.UserContext(), auth.UserID(c))
}

func (h *Handler) Summary(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	paid, err := h.accountPaid(c)
	if err != nil {
		return unavailable("Credit balance is unavailable. Retry or check the backend PocketBase configuration.")
	}
	balance, err := h.Store.Balance(auth.UserID(c), paid)
	if err != nil {
		return unavailable("Credit balance is temporarily unavailable. Retry shortly.")
	}
	membership, err := h.Store.Membership(auth.UserID(c))
	if err != nil {
		return unavailable("Membership is temporarily unavailable.")
	}
	mcpPricing := fiber.Map{"billedActions": []string{"image.generate", "speech.generate", "captions.generate", "transcription", "video.render", "scene.render"},
		"sceneAuthoringCredits": 0, "sceneCompilationCredits": 0, "toolSelectionCredits": 0,
		"serverRenderingBilled": true,
		"speechMinimumCredits":  credits.MinimumAudioCredits, "transcriptionMinimumCredits": credits.MinimumAudioCredits,
		"renderPerMinute": h.Pricing.RenderPerMinute, "sceneRenderPerMinute": h.Pricing.RenderPerMinute,
		"providerPricingConfigured": h.Pricing.ValidateAI() == nil, "renderPricingConfigured": h.Pricing.Validate() == nil}
	response := h.catalog()
	response["balance"], response["membership"], response["mcpPricing"] = balance, membership, mcpPricing
	return c.JSON(response)
}

func unavailable(message string) error {
	return fiber.NewError(fiber.StatusServiceUnavailable, message)
}

func (h *Handler) Meter(c *fiber.Ctx) error {
	if h.Pricing.Validate() != nil {
		return unavailable("API credit pricing is not configured. Ask the administrator to configure billing.")
	}
	id, err := credits.NewID()
	if err != nil {
		return unavailable("Could not start credit accounting. Retry shortly.")
	}
	meter := &credits.Meter{Store: h.Store, Owner: auth.UserID(c), ID: id, Pricing: h.Pricing, DeferredUsage: true}
	if err := h.Store.Begin(meter.Owner, id, true); err != nil {
		if errors.Is(err, credits.ErrInsufficient) {
			return fiber.NewError(fiber.StatusPaymentRequired, "Not enough credits. Buy credits from the API Keys page.")
		}
		if errors.Is(err, credits.ErrBusy) {
			return fiber.NewError(fiber.StatusConflict, "This credit operation is already being processed.")
		}
		return unavailable("Could not start credit accounting. Retry shortly.")
	}
	c.SetUserContext(credits.WithMeter(c.UserContext(), meter))
	err = c.Next()
	if !meter.Detached() {
		openrouter.FinishUsage(c.UserContext())
	}
	return err
}

func decodeInput(c *fiber.Ctx, output any) error {
	if len(c.Body()) > maxBillingBody {
		return fiber.ErrRequestEntityTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(c.Body()))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid billing request.")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fiber.NewError(fiber.StatusBadRequest, "Invalid billing request.")
	}
	return nil
}

func (h *Handler) CreateOrder(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	if !h.purchasesAvailable() {
		return unavailable("Credit purchases are not configured yet.")
	}
	paid, err := h.accountPaid(c)
	if err != nil {
		return unavailable("Subscription verification is unavailable.")
	}
	if !paid {
		return fiber.NewError(fiber.StatusPaymentRequired, "Pro is required to use API credits.")
	}
	var input struct {
		PackID string `json:"packId"`
		PlanID string `json:"planId"`
	}
	if err := decodeInput(c, &input); err != nil {
		return err
	}
	if input.PlanID != "" {
		return fiber.NewError(fiber.StatusBadRequest, "Use membership checkout for membership plans.")
	}
	for _, pack := range h.Packs {
		if pack.ID == input.PackID {
			return h.createOrder(c, pack)
		}
	}
	return fiber.NewError(fiber.StatusBadRequest, "Choose an available credit pack.")
}

func (h *Handler) createOrder(c *fiber.Ctx, pack Pack) error {
	return h.createCheckout(c, credits.Order{PackID: pack.ID, Credits: pack.Credits, USD: pack.USD}, false)
}

func (h *Handler) createCheckout(c *fiber.Ctx, snapshot credits.Order, membership bool) error {
	ref, err := credits.NewID()
	if err != nil {
		return unavailable("Could not start checkout. Retry shortly.")
	}
	returnPath := "/api-keys"
	if membership {
		returnPath = "/membership"
	}
	order, err := h.PayPal.CreateCheckout(c.UserContext(), ref, snapshot.USD, h.AppURL, returnPath)
	if err != nil || order.ApprovalURL() == "" || !orderIDPattern.MatchString(order.ID) {
		return unavailable("PayPal checkout is unavailable. No credits were added; retry shortly.")
	}
	snapshot.ID, snapshot.Owner, snapshot.Reference = order.ID, auth.UserID(c), ref
	if err := h.Store.SaveOrder(snapshot); err != nil {
		return unavailable("Could not save checkout. Retry shortly.")
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"id": order.ID, "approvalUrl": order.ApprovalURL()})
}

func (h *Handler) CaptureOrder(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	if h.PayPal == nil {
		return unavailable("PayPal is not configured.")
	}
	id := c.Params("orderID")
	if !orderIDPattern.MatchString(id) {
		return fiber.ErrNotFound
	}
	snapshot, err := h.Store.Order(id)
	if err != nil || snapshot.Owner != auth.UserID(c) {
		return fiber.ErrNotFound
	}
	if snapshot.CaptureID != "" {
		return c.JSON(fiber.Map{"status": "completed"})
	}
	order, err := h.PayPal.Capture(c.UserContext(), id, snapshot.Reference)
	if err != nil {
		return unavailable("Payment could not be confirmed. Retry verification; you will not be credited twice.")
	}
	if err := h.completeOrder(snapshot, order); err != nil {
		log.Printf("PayPal order %s requires verification: %v", id, err)
		return unavailable("Payment could not be verified. Retry verification or contact support with your order ID.")
	}
	return c.JSON(fiber.Map{"status": "completed"})
}

func (h *Handler) completeOrder(snapshot credits.Order, order paypal.Order) error {
	if order.ID != snapshot.ID || order.Status != "COMPLETED" || order.Intent != "CAPTURE" || len(order.Units) != 1 {
		return errors.New("unexpected payment status")
	}
	unit := order.Units[0]
	if unit.Reference != snapshot.Reference || unit.Amount.Currency != "USD" || unit.Amount.Value != snapshot.USD || len(unit.Payments.Captures) != 1 {
		return errors.New("payment does not match the saved order")
	}
	capture := unit.Payments.Captures[0]
	if capture.ID == "" || capture.Status != "COMPLETED" || capture.Amount.Currency != "USD" || capture.Amount.Value != snapshot.USD {
		return errors.New("capture does not match the saved order")
	}
	return h.Store.CompleteOrder(snapshot.ID, capture.ID)
}

func (h *Handler) Webhook(c *fiber.Ctx) error {
	if h.PayPal == nil {
		return unavailable("PayPal is not configured.")
	}
	if len(c.Body()) > 1<<20 {
		return fiber.ErrRequestEntityTooLarge
	}
	headers := http.Header{}
	c.Request().Header.VisitAll(func(key, value []byte) { headers.Set(string(key), string(value)) })
	if err := h.PayPal.VerifyWebhook(c.UserContext(), headers, c.Body()); err != nil {
		return fiber.ErrUnauthorized
	}
	var event struct {
		Type     string          `json:"event_type"`
		Resource json.RawMessage `json:"resource"`
	}
	if err := json.Unmarshal(c.Body(), &event); err != nil {
		return fiber.ErrBadRequest
	}
	if event.Type == "PAYMENT.CAPTURE.REFUNDED" || event.Type == "PAYMENT.CAPTURE.REVERSED" {
		if err := h.reversePayment(event.Type, event.Resource); err != nil {
			return err
		}
		return c.SendStatus(fiber.StatusNoContent)
	}
	if event.Type != "PAYMENT.CAPTURE.COMPLETED" {
		return c.SendStatus(fiber.StatusNoContent)
	}
	var completed struct {
		Related struct {
			IDs struct {
				OrderID string `json:"order_id"`
			} `json:"related_ids"`
		} `json:"supplementary_data"`
	}
	if err := json.Unmarshal(event.Resource, &completed); err != nil {
		return fiber.ErrBadRequest
	}
	id := completed.Related.IDs.OrderID
	snapshot, err := h.Store.Order(id)
	if errors.Is(err, credits.ErrNotFound) {
		return c.SendStatus(fiber.StatusNoContent)
	}
	if err != nil {
		return fiber.ErrInternalServerError
	}
	order, err := h.PayPal.Get(c.UserContext(), id)
	if err != nil {
		return unavailable("Payment verification unavailable.")
	}
	if err := h.completeOrder(snapshot, order); err != nil {
		return fiber.ErrInternalServerError
	}
	return c.SendStatus(fiber.StatusNoContent)
}
