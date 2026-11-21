package credits

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestMCPWorkflowChargesProvidersAndServerRendering(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	for _, policy := range []WorkflowPolicy{"", MCPServerRender} {
		id := "standard"
		if policy != "" {
			id = string(policy)
		}
		if err := store.Begin("alice", id, true); err != nil {
			t.Fatal(err)
		}
		ctx := WithWorkflowPolicy(context.Background(), policy)
		ctx = WithMeter(ctx, &Meter{Store: store, Owner: "alice", ID: id, Pricing: Pricing{USDPerCredit: "0.01", RenderPerMinute: "10"}})
		if err := ChargeRender(ctx, 60); err != nil {
			t.Fatal(err)
		}
		attempt, err := StartProvider(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := ResolveProvider(ctx, attempt, "provider-"+id, "0.03"); err != nil {
			t.Fatal(err)
		}
		usage, err := store.Operation("alice", id)
		if err != nil || usage == nil || usage.Spent-usage.Render != 15*UnitsPerCredit {
			t.Fatal("provider usage was not charged", usage, err)
		}
		if usage.Render != 10*UnitsPerCredit {
			t.Fatal("MCP/REST render policy changed incorrectly", policy, usage)
		}
		Finish(ctx)
	}
}

func TestFreeMCPWorkCannotMakeUnmeteredProviderCalls(t *testing.T) {
	ctx := WithWorkflowPolicy(context.Background(), MCPFree)
	if _, err := StartProvider(ctx); err == nil {
		t.Fatal("free client authoring permitted an unmetered provider call")
	}
	if err := ChargeRender(ctx, 60); err == nil {
		t.Fatal("free scene-code compilation was allowed to render a video without billing")
	}
	if err := CheckSceneRender(ctx, 60); err == nil {
		t.Fatal("free scene-code compilation was allowed to render a scene without billing")
	}
}

func TestSceneRenderingIsDeduplicatedAndNotRefundedWithFailedFinalVideo(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "credits.db"), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	if err := store.Begin("alice", "server-export", true); err != nil {
		t.Fatal(err)
	}
	ctx := WithWorkflowPolicy(context.Background(), MCPServerRender)
	ctx = WithMeter(ctx, &Meter{Store: store, Owner: "alice", ID: "server-export", Pricing: Pricing{USDPerCredit: "0.01", RenderPerMinute: "6"}})
	for range 2 {
		if err := ChargeSceneRender(ctx, "one-scene.scene.json", 30); err != nil {
			t.Fatal(err)
		}
	}
	if err := ChargeRender(ctx, 60); err != nil {
		t.Fatal(err)
	}
	usage, err := store.Operation("alice", "server-export")
	if err != nil || usage.SceneRender != 3*UnitsPerCredit || usage.Render != 6*UnitsPerCredit || usage.Spent != 9*UnitsPerCredit {
		t.Fatal("scene and final encoding costs were not separated or were duplicated", usage, err)
	}
	RefundRender(ctx)
	usage, err = store.Operation("alice", "server-export")
	if err != nil || usage.SceneRender != 3*UnitsPerCredit || usage.Render != 0 || usage.Spent != 3*UnitsPerCredit {
		t.Fatal("failed final video erased successful server scene work", usage, err)
	}
	Finish(ctx)
	balance, err := store.Balance("alice", true)
	if err != nil || balance.Remaining != 997 {
		t.Fatal(balance, err)
	}
}

func TestRestartKeepsCompletedSceneRenderingButRefundsInterruptedFinalVideo(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credits.db")
	store, err := Open(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Begin("alice", "interrupted-export", true); err != nil {
		t.Fatal(err)
	}
	if err := store.ChargeSceneRender("alice", "interrupted-export", "scene", 3*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.ChargeRender("alice", "interrupted-export", 6*UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	balance, err := store.Balance("alice", true)
	if err != nil || balance.Remaining != 997 {
		t.Fatal("restart erased successful scene work or charged interrupted final output", balance, err)
	}
}
