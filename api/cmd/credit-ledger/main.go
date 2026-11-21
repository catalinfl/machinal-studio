package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"ffmpeg-go-server/internal/integrations/openrouter"
	"ffmpeg-go-server/internal/platform/credits"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	file := flag.String("db", "/data/credits.db", "credit ledger file; stop the API before opening it")
	owner := flag.String("owner", "", "PocketBase user ID")
	attempt := flag.String("attempt", "", "pending attempt to reconcile after verifying provider usage")
	generation := flag.String("generation", "", "verified OpenRouter generation ID")
	usd := flag.String("usd", "", "verified actual provider cost in USD; zero only after verifying no billable generation")
	price := flag.String("usd-per-credit", "", "USD value of one credit when this operation started")
	confirm := flag.Bool("confirm", false, "commit a verified reconciliation")
	provider := flag.Bool("reconcile-provider", false, "query actual provider usage for pending generations and settle the operation")
	refunds := flag.Bool("refund-requests", false, "list pending merchant refund reviews; never issues a payment or refund")
	flag.Parse()
	if *owner == "" && !*refunds {
		return fmt.Errorf("-owner is required")
	}
	store, err := credits.Open(*file, time.Now)
	if err != nil {
		return err
	}
	defer store.Close()
	if *refunds {
		requests, err := store.RefundRequests()
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(requests)
	}
	pending, err := store.Pending(*owner)
	if err != nil {
		return err
	}
	if *provider {
		pricing := credits.PricingFromEnv()
		if *price != "" {
			pricing.USDPerCredit = *price
		}
		client := openrouter.Client{APIKey: os.Getenv("OPENROUTER_API_KEY"), BaseURL: os.Getenv("OPENROUTER_BASE_URL")}
		if err := reconcileProvider(store, *owner, pending, pricing, client); err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]string{"status": "reconciled"})
	}
	if *attempt == "" {
		return json.NewEncoder(os.Stdout).Encode(pending)
	}
	if pending == nil || !pending.Attempts[*attempt] {
		return fmt.Errorf("pending attempt not found")
	}
	if !*confirm {
		return fmt.Errorf("verify the cost in OpenRouter, then supply -confirm to commit it")
	}
	ctx := credits.WithMeter(context.Background(), &credits.Meter{
		Store: store, Owner: *owner, ID: pending.ID, Pricing: credits.Pricing{USDPerCredit: *price},
	})
	if err := credits.ResolveProvider(ctx, *attempt, *generation, *usd); err != nil {
		return err
	}
	if err := store.RefundRender(*owner, pending.ID); err != nil {
		return err
	}
	if err := store.Finish(*owner, pending.ID); err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]string{"status": "reconciled"})
}

func reconcileProvider(store *credits.Store, owner string, pending *credits.Reservation, pricing credits.Pricing, client openrouter.Client) error {
	if pending == nil {
		return fmt.Errorf("no pending operation")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ctx = credits.WithMeter(ctx, &credits.Meter{Store: store, Owner: owner, ID: pending.ID, Pricing: pricing, DeferredUsage: true})
	if err := client.ReconcileUsage(ctx); err != nil {
		return fmt.Errorf("reconcile provider usage: %w", err)
	}
	return store.Finish(owner, pending.ID)
}
