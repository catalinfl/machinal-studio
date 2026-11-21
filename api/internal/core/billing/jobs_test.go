package billing

import (
	"context"
	"errors"
	"testing"

	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/jobqueue"
)

func TestQueuedJobStartsAccountingAtExecutionWithoutReservingCredits(t *testing.T) {
	h, _ := billingFixture(t)
	job := jobqueue.Job{ID: "saved-job-reference", Owner: "alice", Input: jobqueue.Input{Billed: true}}
	before, err := h.Store.Pending(job.Owner)
	if err != nil || before != nil {
		t.Fatal(before, err)
	}
	ctx, finish, err := h.PrepareJob(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	if meter := credits.FromContext(ctx); meter == nil || meter.ID != job.ID || meter.Owner != job.Owner {
		t.Fatal("worker did not use the durable job identity for billing")
	}
	if _, _, err := h.PrepareJob(context.Background(), job); !errors.Is(err, credits.ErrBusy) {
		t.Fatal("duplicate operation allowed", err)
	}
	if balance, err := h.Store.Balance(job.Owner, true); err != nil || balance.Remaining != 1000 || balance.Reserved != 0 {
		t.Fatal("job execution reserved the wallet", balance, err)
	}
	finish()
	pending, err := h.Store.Pending(job.Owner)
	if err != nil || pending != nil {
		t.Fatal("finished operation retained accounting state", pending, err)
	}
}

func TestLegacyUnbilledJobsKeepTheirAcceptedContractAndRecheckAccess(t *testing.T) {
	h, _ := billingFixture(t)
	ctx, finish, err := h.PrepareJob(context.Background(), jobqueue.Job{Owner: "alice"})
	if err != nil || credits.FromContext(ctx) != nil {
		t.Fatal(err)
	}
	finish()
	h.paid = func(context.Context, string) (bool, error) { return false, nil }
	if _, _, err := h.PrepareJob(context.Background(), jobqueue.Job{Owner: "alice"}); err == nil {
		t.Fatal("expired subscription was not checked at execution")
	}
}

func TestBrowserAndAPIJobsDebitTheSameWallet(t *testing.T) {
	h, _ := billingFixture(t)
	for _, kind := range []string{"ai-image", "automation-render"} {
		job := jobqueue.Job{ID: "shared-" + kind, Kind: kind, Owner: "alice", Input: jobqueue.Input{Billed: true}}
		ctx, finish, err := h.PrepareJob(context.Background(), job)
		if err != nil {
			t.Fatal(err)
		}
		attempt, err := credits.StartProvider(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := credits.ResolveProvider(ctx, attempt, "gen-"+kind, "0.02"); err != nil {
			t.Fatal(err)
		}
		finish()
	}
	if balance, err := h.Store.Balance("alice", true); err != nil || balance.Remaining != 980 {
		t.Fatal("browser and API usage did not share the account", balance, err)
	}
}

func TestBrowserAIJobCannotStartAtZeroBalance(t *testing.T) {
	h, _ := billingFixture(t)
	if err := h.Store.Begin("alice", "spent", true); err != nil {
		t.Fatal(err)
	}
	if err := h.Store.ChargeRender("alice", "spent", 1000*credits.UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := h.Store.Finish("alice", "spent"); err != nil {
		t.Fatal(err)
	}
	job := jobqueue.Job{ID: "browser-work", Kind: "ai-speech", Owner: "alice", Input: jobqueue.Input{Billed: true}}
	if _, _, err := h.PrepareJob(context.Background(), job); !errors.Is(err, credits.ErrInsufficient) {
		t.Fatal("browser AI bypassed the empty wallet", err)
	}
}

func TestFreeMCPJobsWorkAtZeroBalanceWithoutPricing(t *testing.T) {
	h, _ := billingFixture(t)
	if err := h.Store.Begin("alice", "spent-before", true); err != nil {
		t.Fatal(err)
	}
	if err := h.Store.ChargeRender("alice", "spent-before", 1000*credits.UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := h.Store.Finish("alice", "spent-before"); err != nil {
		t.Fatal(err)
	}
	h.Pricing = credits.Pricing{}
	ctx, finish, err := h.PrepareJob(context.Background(), jobqueue.Job{ID: "free-scene", Owner: "alice", Input: jobqueue.Input{CreditPolicy: credits.MCPFree}})
	if err != nil {
		t.Fatal("free scene/render required a positive balance or prices", err)
	}
	defer finish()
	if credits.FromContext(ctx) != nil || !credits.IsMCPWorkflow(ctx) {
		t.Fatal("free job lost its policy or created a credit meter")
	}
	if balance, err := h.Store.Balance("alice", true); err != nil || balance.Remaining != 0 {
		t.Fatal(balance, err)
	}
}

func TestMCPMediaOnlyJobsCannotRenderWithoutConfiguredRenderPricing(t *testing.T) {
	h, _ := billingFixture(t)
	h.Pricing = credits.Pricing{USDPerCredit: "0.01"}
	ctx, finish, err := h.PrepareJob(context.Background(), jobqueue.Job{ID: "image-and-render", Owner: "alice", Input: jobqueue.Input{Billed: true, CreditPolicy: credits.MCPMediaOnly}})
	if err != nil {
		t.Fatal(err)
	}
	defer finish()
	if credits.FromContext(ctx) == nil {
		t.Fatal("paid image/speech/captions were not metered")
	}
	if err := credits.ChargeRender(ctx, 60); err == nil {
		t.Fatal("server rendering bypassed missing render pricing")
	}
	usage, err := h.Store.Operation("alice", "image-and-render")
	if err != nil || usage == nil || usage.Render != 0 {
		t.Fatal("MCP render retained a debit", usage, err)
	}
}

func TestMCPServerRenderRequiresConfiguredPricing(t *testing.T) {
	h, _ := billingFixture(t)
	h.Pricing = credits.Pricing{USDPerCredit: "0.01"}
	job := jobqueue.Job{ID: "server-render", Owner: "alice", Input: jobqueue.Input{Billed: true, CreditPolicy: credits.MCPServerRender}}
	if _, _, err := h.PrepareJob(context.Background(), job); err == nil {
		t.Fatal("server render started without render pricing")
	}
	h.Pricing.RenderPerMinute = "2"
	ctx, finish, err := h.PrepareJob(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	defer finish()
	if err := credits.ChargeRender(ctx, 60); err != nil {
		t.Fatal(err)
	}
	if err := credits.ChargeSceneRender(ctx, "scene.scene.json", 60); err != nil {
		t.Fatal(err)
	}
	usage, err := h.Store.Operation("alice", job.ID)
	if err != nil || usage.Render != 2*credits.UnitsPerCredit || usage.SceneRender != 2*credits.UnitsPerCredit {
		t.Fatal("server video/scene charges were lost", usage, err)
	}
}
