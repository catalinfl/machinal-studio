package credits

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"sync/atomic"
)

type meterKey struct{}
type audioMinimumKey struct{}
type localExecutionKey struct{}

func WithLocalExecution(ctx context.Context) context.Context {
	return context.WithValue(ctx, localExecutionKey{}, true)
}

func localExecution(ctx context.Context) bool {
	local, _ := ctx.Value(localExecutionKey{}).(bool)
	return local
}

func WithAudioMinimum(ctx context.Context) context.Context {
	return context.WithValue(ctx, audioMinimumKey{}, true)
}

type Meter struct {
	Store         *Store
	Owner         string
	ID            string
	Pricing       Pricing
	DeferredUsage bool
	detached      atomic.Bool
}

func NewID() (string, error) {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", fmt.Errorf("generate credit reference: %w", err)
	}
	return hex.EncodeToString(random[:]), nil
}

func WithMeter(ctx context.Context, meter *Meter) context.Context {
	return context.WithValue(ctx, meterKey{}, meter)
}

func FromContext(ctx context.Context) *Meter {
	meter, _ := ctx.Value(meterKey{}).(*Meter)
	return meter
}

func Detach(ctx context.Context) {
	if meter := FromContext(ctx); meter != nil {
		meter.detached.Store(true)
	}
}

func (m *Meter) Detached() bool { return m.detached.Load() }

func Finish(ctx context.Context) {
	if meter := FromContext(ctx); meter != nil {
		if err := meter.Store.Finish(meter.Owner, meter.ID); err != nil {
			log.Printf("credit operation %s needs reconciliation: %v", meter.ID, err)
		}
	}
}

func StartProvider(ctx context.Context) (string, error) {
	if WorkflowPolicyFromContext(ctx) == MCPFree {
		return "", fmt.Errorf("this MCP operation does not permit provider calls")
	}
	meter := FromContext(ctx)
	if meter == nil {
		return "", nil
	}
	attempt, err := NewID()
	if err != nil {
		return "", err
	}
	minimum := int64(0)
	if audio, _ := ctx.Value(audioMinimumKey{}).(bool); audio {
		minimum = MinimumAudioCredits * UnitsPerCredit
	}
	pricing := &AIPricing{USDPerCredit: meter.Pricing.USDPerCredit, BudgetPercent: aiProviderBudgetPercent}
	if err := meter.Store.startAttemptWithPricing(meter.Owner, meter.ID, attempt, meter.DeferredUsage, minimum, pricing); err != nil {
		return "", err
	}
	return attempt, nil
}

func ResolveProvider(ctx context.Context, attempt, generation, usd string) error {
	meter := FromContext(ctx)
	if meter == nil {
		return nil
	}
	operation, err := meter.Store.Operation(meter.Owner, meter.ID)
	if err != nil {
		return err
	}
	if operation == nil {
		return ErrNotFound
	}
	pricing, percent := meter.Pricing, int64(aiProviderBudgetPercent)
	if operation.AIPricing != nil {
		pricing.USDPerCredit, percent = operation.AIPricing.USDPerCredit, operation.AIPricing.BudgetPercent
	}
	units, err := pricing.aiUnitsAtPercent(usd, operation.Minimums[attempt], percent)
	if err != nil {
		return err
	}
	if generation == "" {
		generation = attempt
	}
	return meter.Store.ResolveAttempt(meter.Owner, meter.ID, attempt, generation, units)
}

func ChargeRender(ctx context.Context, seconds float64) error {
	if WorkflowPolicyFromContext(ctx) == MCPFree {
		return fmt.Errorf("server rendering requires a billed render operation")
	}
	if localExecution(ctx) {
		return nil
	}
	meter := FromContext(ctx)
	if meter == nil {
		if IsMCPWorkflow(ctx) {
			return fmt.Errorf("server render credit accounting is unavailable")
		}
		return nil
	}
	units, err := meter.Pricing.RenderUnits(seconds)
	if err != nil {
		return err
	}
	return meter.Store.chargeRender(meter.Owner, meter.ID, units, meter.Pricing.renderUsage("video.render", seconds, units))
}

func CheckSceneRender(ctx context.Context, seconds float64) error {
	if WorkflowPolicyFromContext(ctx) == MCPFree {
		return fmt.Errorf("scene rendering requires a billed server operation")
	}
	if localExecution(ctx) {
		return nil
	}
	meter := FromContext(ctx)
	if meter == nil {
		if IsMCPWorkflow(ctx) {
			return fmt.Errorf("scene render credit accounting is unavailable")
		}
		return nil
	}
	_, err := meter.Pricing.RenderUnits(seconds)
	return err
}

func ChargeSceneRender(ctx context.Context, scene string, seconds float64) error {
	if err := CheckSceneRender(ctx, seconds); err != nil {
		return err
	}
	meter := FromContext(ctx)
	if meter == nil {
		return nil
	}
	units, err := meter.Pricing.RenderUnits(seconds)
	if err != nil {
		return err
	}
	return meter.Store.chargeSceneRender(meter.Owner, meter.ID, scene, units, meter.Pricing.renderUsage("scene.render", seconds, units))
}

func RefundRender(ctx context.Context) {
	if meter := FromContext(ctx); meter != nil {
		if err := meter.Store.RefundRender(meter.Owner, meter.ID); err != nil {
			log.Printf("remove failed render debit %s: %v", meter.ID, err)
		}
	}
}
