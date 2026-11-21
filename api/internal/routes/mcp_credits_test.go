package routes

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"ffmpeg-go-server/internal/platform/credits"
)

func TestMCPCreditsBelongOnlyToAuthenticatedAccount(t *testing.T) {
	fixture := newMCPFixture(t)
	ledger := fixture.billing.Store
	if err := ledger.Begin("mcpalice", "completed-render", true); err != nil {
		t.Fatal(err)
	}
	if err := ledger.ChargeRender("mcpalice", "completed-render", 100*credits.UnitsPerCredit); err != nil {
		t.Fatal(err)
	}
	if err := ledger.Finish("mcpalice", "completed-render"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		key       string
		remaining float64
	}{{mcpAliceKey, 900}, {mcpBobKey, 1000}} {
		result, output := mcpTool(t, fixture, test.key, "get_credits", map[string]any{})
		if result.IsError || output.StatusCode != 200 {
			t.Fatal("credit lookup failed", result, output)
		}
		data := output.Data.(map[string]any)
		balance := data["balance"].(map[string]any)
		if balance["remaining"] != test.remaining || balance["monthlyRemaining"] != test.remaining {
			t.Fatal("wrong account balance", balance)
		}
		if data["pricing"].(map[string]any)["configured"] != true {
			t.Fatal("configured pricing was lost", data)
		}
		pricing := data["mcpPricing"].(map[string]any)
		if pricing["speechMinimumCredits"] != float64(1) || pricing["transcriptionMinimumCredits"] != float64(1) {
			t.Fatal("MCP lost the audio minimums from REST", pricing)
		}
	}
	request := httptest.NewRequest("GET", "/v1/billing/credits?owner=mcpbob", nil)
	request.Header.Set("Authorization", "Bearer "+mcpAliceKey)
	response, err := fixture.app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var summary struct{ Balance credits.Balance }
	if err := json.NewDecoder(response.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" || summary.Balance.Remaining != 900 {
		t.Fatal("REST credit lookup escaped account scope or was cacheable", response.StatusCode, summary)
	}
	fixture.billing.Pricing = credits.Pricing{}
	result, output := mcpTool(t, fixture, mcpAliceKey, "get_credits", map[string]any{})
	if result.IsError || output.Data.(map[string]any)["pricing"].(map[string]any)["configured"] != false {
		t.Fatal("unconfigured paid pricing should not hide the actual balance", result, output)
	}
}

func TestMCPCreditsExposePendingUsageWithoutReservingBalance(t *testing.T) {
	fixture := newMCPFixture(t)
	ledger := fixture.billing.Store
	if err := ledger.Begin("mcpalice", "active-job", true); err != nil {
		t.Fatal(err)
	}
	if err := ledger.StartAttempt("mcpalice", "active-job", "provider-pending"); err != nil {
		t.Fatal(err)
	}
	result, output := mcpTool(t, fixture, mcpAliceKey, "get_credits", map[string]any{})
	balance := output.Data.(map[string]any)["balance"].(map[string]any)
	if result.IsError || balance["remaining"] != float64(1000) || balance["reserved"] != float64(0) || balance["usagePending"] != true {
		t.Fatal("pending usage reserved the account balance", result, balance)
	}
}

func TestMCPCreditsUnavailableDoesNotInventBalance(t *testing.T) {
	fixture := newMCPFixture(t)
	if err := fixture.billing.Store.Close(); err != nil {
		t.Fatal(err)
	}
	result, output := mcpTool(t, fixture, mcpAliceKey, "get_credits", map[string]any{})
	if !result.IsError || output.StatusCode != 503 {
		t.Fatal("unavailable ledger did not fail closed", result, output)
	}
}

func TestMCPCreditsRejectRevokedAndUnpaidKeys(t *testing.T) {
	fixture := newMCPFixture(t)
	fixture.revoked.Store(true)
	response, _ := mcpRPC(t, fixture.app, mcpAliceKey, "tools/call", map[string]any{"name": "get_credits", "arguments": map[string]any{}})
	if response.StatusCode != 401 {
		t.Fatal("revoked key read credits", response.StatusCode)
	}
	fixture.revoked.Store(false)
	fixture.unpaid.Store(true)
	response, _ = mcpRPC(t, fixture.app, mcpAliceKey, "tools/call", map[string]any{"name": "get_credits", "arguments": map[string]any{}})
	if response.StatusCode != 402 {
		t.Fatal("unpaid key retained MCP credit access", response.StatusCode)
	}
}

func TestMCPEditingReferenceStillRequiresCurrentAuthentication(t *testing.T) {
	fixture := newMCPFixture(t)
	for _, key := range []string{"", "pocketbase-login-token", "mach_invalid"} {
		response, _ := mcpRPC(t, fixture.app, key, "tools/call", map[string]any{"name": "get_editing_reference", "arguments": map[string]any{"topic": "styles", "id": "cinematic"}})
		if response.StatusCode != 401 {
			t.Fatal("embedded reference bypassed authentication", response.StatusCode)
		}
	}
	result, output := mcpTool(t, fixture, mcpAliceKey, "get_editing_reference", map[string]any{"topic": "effects", "id": "film-grain"})
	if result.IsError || output.StatusCode != 200 {
		t.Fatal("authenticated reference lookup failed", result, output)
	}
	fixture.revoked.Store(true)
	response, _ := mcpRPC(t, fixture.app, mcpAliceKey, "resources/read", map[string]any{"uri": "machinal://examples/scene-generation"})
	if response.StatusCode != 401 {
		t.Fatal("revoked key could still read an example", response.StatusCode)
	}
}
