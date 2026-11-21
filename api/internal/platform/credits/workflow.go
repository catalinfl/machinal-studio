package credits

import "context"

type WorkflowPolicy string

const (
	MCPMediaOnly    WorkflowPolicy = "mcp-media-only"
	MCPFree         WorkflowPolicy = "mcp-free"
	MCPServerRender WorkflowPolicy = "mcp-server-render"
)

type workflowKey struct{}

// Trusted route handlers assign this policy; request headers and recipe fields cannot choose it.
func WithWorkflowPolicy(ctx context.Context, policy WorkflowPolicy) context.Context {
	return context.WithValue(ctx, workflowKey{}, policy)
}

func WorkflowPolicyFromContext(ctx context.Context) WorkflowPolicy {
	policy, _ := ctx.Value(workflowKey{}).(WorkflowPolicy)
	return policy
}

func IsMCPWorkflow(ctx context.Context) bool {
	policy := WorkflowPolicyFromContext(ctx)
	return policy == MCPMediaOnly || policy == MCPFree || policy == MCPServerRender
}
