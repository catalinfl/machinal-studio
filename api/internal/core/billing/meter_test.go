package billing

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"ffmpeg-go-server/internal/integrations/openrouter"

	"github.com/gofiber/fiber/v2"
)

func TestMeterLooksUpCostOnlyAfterAllActionsAndPreservesOutput(t *testing.T) {
	for _, metadataAvailable := range []bool{true, false} {
		t.Run(fmt.Sprint(metadataAvailable), func(t *testing.T) {
			h, app := billingFixture(t)
			actions, lookups := 0, 0
			finished := false
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/generation" {
					lookups++
					if !finished || actions != 2 {
						t.Error("cost lookup happened before all actions completed")
					}
					if !metadataAvailable {
						w.WriteHeader(http.StatusNotFound)
						return
					}
					fmt.Fprintf(w, `{"data":{"id":%q,"total_cost":0.025}}`, r.URL.Query().Get("id"))
					return
				}
				actions++
				fmt.Fprintf(w, `{"id":"gen-%d","output":"generated media"}`, actions)
			}))
			defer server.Close()
			t.Setenv("OPENROUTER_BASE_URL", server.URL)
			t.Setenv("OPENROUTER_API_KEY", "fixture")
			app.Post("/generate", h.Meter, func(c *fiber.Ctx) error {
				for range 2 {
					req, err := http.NewRequestWithContext(c.UserContext(), http.MethodPost, server.URL+"/images", nil)
					if err != nil {
						return err
					}
					if _, _, _, err := (openrouter.Client{HTTPClient: server.Client()}).Do(req, 4096, "fixture"); err != nil {
						return err
					}
				}
				finished = true
				return c.SendString("saved images and voice")
			})
			response, err := app.Test(httptest.NewRequest(http.MethodPost, "/generate", nil), -1)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil || response.StatusCode != http.StatusOK || string(body) != "saved images and voice" || lookups == 0 {
				t.Fatalf("output lost: %d %s, lookups %d, %v", response.StatusCode, body, lookups, err)
			}
			balance, err := h.Store.Balance("alice", true)
			if err != nil || balance.UsagePending == metadataAvailable {
				t.Fatalf("balance: %+v %v", balance, err)
			}
			if metadataAvailable && balance.Remaining != 976 {
				t.Fatalf("incorrect final debit: %+v", balance)
			}
		})
	}
}
