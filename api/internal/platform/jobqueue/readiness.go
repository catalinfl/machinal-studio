package jobqueue

import (
	"context"
	"fmt"
	"net/http"
)

func (s *PocketBase) Check(ctx context.Context) error {
	var schema struct {
		Version int    `json:"version"`
		Queue   string `json:"queue"`
		APIKeys string `json:"apiKeys"`
	}
	if err := s.requestJSON(ctx, http.MethodGet, "/api/direction/jobs/schema", "schema", nil, &schema); err != nil {
		return err
	}
	if schema.Version != 1 || schema.Queue != "direction_jobs" || schema.APIKeys != "direction_api_keys" {
		return fmt.Errorf("incompatible PocketBase schema contract")
	}
	return nil
}
