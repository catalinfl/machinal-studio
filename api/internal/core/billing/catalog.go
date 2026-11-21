package billing

import (
	"ffmpeg-go-server/internal/platform/credits"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) Catalog(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	return c.JSON(h.catalog())
}

func (h *Handler) catalog() fiber.Map {
	packs := []Pack{}
	if h.purchasesAvailable() {
		packs = h.Packs
	}
	plans := []MembershipPlan{}
	if h.membershipsAvailable() {
		plans = h.MembershipPlans
	}
	return fiber.Map{
		"memberships": fiber.Map{"available": h.membershipsAvailable(), "plans": plans, "renewal": "manual",
			"includedCredits": credits.MonthlyAllowance / credits.UnitsPerCredit, "allowanceDays": credits.PrepaidAllowanceDays},
		"payments": fiber.Map{"mode": h.paymentMode()},
		"pricing": fiber.Map{"configured": h.Pricing.Validate() == nil,
			"usdPerCredit": h.Pricing.USDPerCredit, "renderPerMinute": h.Pricing.RenderPerMinute},
		"purchase": fiber.Map{"available": h.purchasesAvailable(), "packs": packs},
	}
}
