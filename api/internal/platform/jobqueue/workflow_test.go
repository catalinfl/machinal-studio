package jobqueue

import (
	"context"
	"testing"

	"ffmpeg-go-server/internal/platform/credits"
)

func TestWorkerRestoresMCPPolicyFromDurableInputBeforeBillingAndExecution(t *testing.T) {
	for _, policy := range []credits.WorkflowPolicy{credits.MCPFree, credits.MCPMediaOnly, credits.MCPServerRender} {
		t.Run(string(policy), func(t *testing.T) {
			prepared, executed := false, false
			service := New(repositoryStub{}, map[string]Task{"scene-compile": func(ctx context.Context, _ Job) Result {
				executed = true
				if credits.WorkflowPolicyFromContext(ctx) != policy {
					t.Error("execution lost the stored MCP billing policy")
				}
				return Result{StatusCode: 200, Body: []byte(`{"ok":true}`)}
			}}, Options{Prepare: func(ctx context.Context, _ Job) (context.Context, func(), error) {
				prepared = true
				if credits.WorkflowPolicyFromContext(ctx) != policy {
					t.Error("billing did not receive the stored MCP policy")
				}
				return ctx, func() {}, nil
			}})
			result := service.run(context.Background(), Job{Kind: "scene-compile", Input: Input{CreditPolicy: policy}})
			if result.StatusCode != 200 || !prepared || !executed {
				t.Fatal("durable MCP workflow did not run", result)
			}
		})
	}
}

func TestLegacyQueuedMCPRenderCannotRetainFreeBilling(t *testing.T) {
	service := New(repositoryStub{}, map[string]Task{"automation-render": func(ctx context.Context, job Job) Result {
		if credits.WorkflowPolicyFromContext(ctx) != credits.MCPServerRender || !job.Input.Billed {
			t.Error("legacy queued render bypassed server billing")
		}
		return Result{StatusCode: 200, Body: []byte(`{"ok":true}`)}
	}}, Options{Prepare: func(ctx context.Context, job Job) (context.Context, func(), error) {
		if !job.Input.Billed || job.Input.CreditPolicy != credits.MCPServerRender {
			t.Error("legacy render was not upgraded before accounting")
		}
		return ctx, func() {}, nil
	}})
	result := service.run(context.Background(), Job{Kind: "automation-render", Input: Input{CreditPolicy: credits.MCPFree}})
	if result.StatusCode != 200 {
		t.Fatal(result)
	}
}

func TestLostCompilationMarkerCannotTriggerServerAIGeneration(t *testing.T) {
	service := New(repositoryStub{}, map[string]Task{"ai-scene": func(context.Context, Job) Result {
		t.Error("free compilation fell back to server AI generation")
		return Result{StatusCode: 200, Body: []byte(`{}`)}
	}}, Options{Prepare: func(ctx context.Context, _ Job) (context.Context, func(), error) {
		t.Error("invalid free scene job reached billing")
		return ctx, func() {}, nil
	}})
	result := service.run(context.Background(), Job{Kind: "ai-scene", Input: Input{CreditPolicy: credits.MCPFree}})
	if result.StatusCode != 400 {
		t.Fatal("missing task metadata was not rejected", result)
	}
}
