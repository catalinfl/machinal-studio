package jobqueue

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

const sceneCompileOperation = "scene-compile"
const sceneQueueKind = "ai-scene"
const sceneTaskParameter = "_direction_task"

func encodeStoredJob(job Job) Job {
	// Deployed hooks validate a fixed kind allowlist. Keep the queue category
	// compatible and persist the exact task in the established input metadata.
	if job.Kind == sceneCompileOperation {
		job.Kind = sceneQueueKind
		if job.Input.Query != "" {
			job.Input.Query += "&"
		}
		job.Input.Query += sceneTaskParameter + "=" + sceneCompileOperation
	}
	return job
}

func (s *PocketBase) restoreJob(ctx context.Context, job Job) (Job, error) {
	if job.Kind != sceneQueueKind {
		return job, nil
	}
	// Status/start/list responses omit private input; claims include it. Read only
	// dispatch metadata after the scoped hook has authorized the returned job.
	if job.Input.Payload == "" {
		if !idPattern.MatchString(job.ID) {
			return Job{}, fmt.Errorf("read scene job metadata: invalid job identity")
		}
		var metadata Job
		path := "/api/collections/direction_jobs/records/" + job.ID + "?fields=id,owner,session,input"
		if err := s.requestJSON(ctx, http.MethodGet, path, "metadata", nil, &metadata); err != nil {
			return Job{}, err
		}
		if metadata.ID != job.ID || metadata.Owner != job.Owner || metadata.Session != job.Session {
			return Job{}, fmt.Errorf("read scene job metadata: ownership mismatch")
		}
		if metadata.Input.Payload == "" {
			return Job{}, fmt.Errorf("read scene job metadata: missing private input")
		}
		job.Input = metadata.Input
	}
	return restoreStoredJob(job), nil
}

func restoreStoredJob(job Job) Job {
	if job.Kind != sceneQueueKind {
		return job
	}
	query, err := url.ParseQuery(job.Input.Query)
	if err == nil && query.Get(sceneTaskParameter) == sceneCompileOperation {
		job.Kind = sceneCompileOperation
		query.Del(sceneTaskParameter)
		job.Input.Query = query.Encode()
	}
	return job
}

func (s *PocketBase) TimingHistory(ctx context.Context, job Job) ([]Job, error) {
	var jobs []Job
	if err := s.request(ctx, "list", scope(job.Owner, job.Session, ""), &jobs); err != nil {
		return nil, err
	}
	return jobs, nil
}
