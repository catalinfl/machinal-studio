package routes

import (
	"net/http/httptest"
	"testing"
)

func TestMCPReusesAuthenticationOnlyWithinOneHTTPRequest(t *testing.T) {
	fixture := newMCPFixture(t)
	for range 2 {
		beforeKeys, beforeAccess := fixture.keyReads.Load(), fixture.accessReads.Load()
		result, output := mcpTool(t, fixture, mcpAliceKey, "get_project", map[string]any{"projectId": fixture.project.ID})
		if result.IsError || output.StatusCode != 200 {
			t.Fatal(result, output)
		}
		if fixture.keyReads.Load()-beforeKeys != 1 || fixture.accessReads.Load()-beforeAccess != 1 {
			t.Fatal("MCP repeated external authentication during internal REST dispatch")
		}
	}
	fixture.revoked.Store(true)
	request := httptest.NewRequest("GET", "/v1/projects/"+fixture.project.ID, nil)
	request.Header.Set("Authorization", "Bearer "+mcpAliceKey)
	request.Header.Set("X-Direction-MCP-Client-IP", "127.0.0.1")
	request.Header.Set("X-Machinal-Verified", "true")
	response, err := fixture.app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("direct REST request reused a previous principal or trusted a header", response.StatusCode)
	}
}
