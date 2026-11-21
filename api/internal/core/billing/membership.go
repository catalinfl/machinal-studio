package billing

import (
	"errors"
	"strings"
	"unicode/utf8"

	"ffmpeg-go-server/internal/platform/auth"
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) Access(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	paid, err := h.accountPaid(c)
	if err != nil {
		return unavailable("Membership verification is temporarily unavailable.")
	}
	return c.JSON(fiber.Map{"paid": paid})
}

func (h *Handler) CreateMembershipOrder(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	if !h.membershipsAvailable() {
		return unavailable("Membership purchases are not configured yet.")
	}
	var input struct {
		PlanID string `json:"planId"`
	}
	if err := decodeInput(c, &input); err != nil {
		return err
	}
	for _, plan := range h.MembershipPlans {
		if plan.ID == input.PlanID {
			return h.createCheckout(c, credits.Order{PackID: plan.ID, PlanName: plan.Name, MembershipDays: plan.Days, Credits: plan.Credits, USD: plan.USD}, true)
		}
	}
	return fiber.NewError(fiber.StatusBadRequest, "Choose an available membership plan.")
}

func (h *Handler) Orders(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	orders, err := h.Store.Orders(auth.UserID(c))
	if err != nil {
		return unavailable("Payment history is temporarily unavailable.")
	}
	items := make([]fiber.Map, 0, min(len(orders), 50))
	for _, order := range orders[:min(len(orders), 50)] {
		status := "awaiting-payment"
		if order.CaptureID != "" {
			status = "completed"
		}
		if order.PaymentReversed || order.Reversed > 0 {
			status = "refunded-or-reversed"
		}
		items = append(items, fiber.Map{"id": order.ID, "planName": order.PlanName, "credits": order.Credits,
			"membershipDays": order.MembershipDays, "usd": order.USD, "createdAt": order.CreatedAt,
			"status": status, "refundRequestedAt": order.RefundRequestedAt})
	}
	return c.JSON(items)
}

func (h *Handler) RequestRefund(c *fiber.Ctx) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	if !orderIDPattern.MatchString(c.Params("orderID")) {
		return fiber.ErrNotFound
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if err := decodeInput(c, &input); err != nil {
		return err
	}
	if size := utf8.RuneCountInString(strings.TrimSpace(input.Reason)); size < 10 || size > 1000 {
		return fiber.NewError(fiber.StatusBadRequest, "Describe the refund reason in 10-1000 characters.")
	}
	_, err := h.Store.RequestRefund(auth.UserID(c), c.Params("orderID"), input.Reason)
	if errors.Is(err, credits.ErrNotFound) {
		return fiber.ErrNotFound
	}
	if err != nil {
		return fiber.NewError(fiber.StatusConflict, "This payment cannot accept a refund request. Contact support with the order ID.")
	}
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"status": "requested", "message": "Saved for merchant review. This is not an approved refund or a PayPal payout."})
}
