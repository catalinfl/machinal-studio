package billing

import (
	"context"
	"errors"
	"fmt"

	"ffmpeg-go-server/internal/integrations/openrouter"
	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/jobqueue"
	"github.com/gofiber/fiber/v2"
)

func (h *Handler) RequireJobPricing(c *fiber.Ctx) error {
	if credits.WorkflowPolicyFromContext(c.UserContext()) == credits.MCPFree {
		return c.Next()
	}
	if h.validateJobPricing(c.UserContext()) != nil {
		return unavailable("API credit pricing is not configured. Ask the administrator to configure billing.")
	}
	return c.Next()
}

func (h *Handler) validateJobPricing(ctx context.Context) error {
	if credits.WorkflowPolicyFromContext(ctx) == credits.MCPMediaOnly {
		return h.Pricing.ValidateAI()
	}
	return h.Pricing.Validate()
}

func (h *Handler) PrepareJob(ctx context.Context, job jobqueue.Job) (context.Context, func(), error) {
	if job.Input.CreditPolicy != "" {
		ctx = credits.WithWorkflowPolicy(ctx, job.Input.CreditPolicy)
	}
	paid, err := h.paid(ctx, job.Owner)
	if err != nil {
		return ctx, nil, fmt.Errorf("verify job subscription: %w", err)
	}
	if !paid {
		return ctx, nil, errors.New("job subscription is no longer active")
	}
	if !job.Input.Billed {
		return ctx, func() {}, nil
	}
	if err := h.validateJobPricing(ctx); err != nil {
		return ctx, nil, err
	}
	if err := h.Store.Begin(job.Owner, job.ID, true); err != nil {
		return ctx, nil, fmt.Errorf("start job credit accounting: %w", err)
	}
	ctx = credits.WithMeter(ctx, &credits.Meter{Store: h.Store, Owner: job.Owner, ID: job.ID, Pricing: h.Pricing, DeferredUsage: true})
	return ctx, func() { openrouter.FinishUsage(ctx) }, nil
}
