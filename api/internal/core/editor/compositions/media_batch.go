package compositions

import (
	"context"
	"sync"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/imagegen"
)

// Provider work shares a process-wide bound, including concurrent accounts.
var mediaJobSlots = make(chan struct{}, imagegen.ConcurrencyLimit())

type mediaJobResult struct {
	job    document.Job
	assets []document.Asset
	err    error
}

func independentMediaJob(job document.Job) bool {
	return job.Type == "image.generate" || job.Type == "speech.generate"
}

func materializeMediaJobs(ctx context.Context, root, session string, doc document.Document, assets []document.Asset, jobs []document.Job) (document.Document, []document.Asset, string, error) {
	for index := 0; index < len(jobs); {
		job := jobs[index]
		if job.ResultAssetID != "" {
			index++
			continue
		}
		if !independentMediaJob(job) {
			var err error
			doc, assets, err = materializeMediaJob(ctx, root, session, doc, assets, job)
			if err != nil {
				return doc, assets, job.ID, err
			}
			index++
			continue
		}
		end := index + 1
		for end < len(jobs) && independentMediaJob(jobs[end]) {
			end++
		}
		results := materializeMediaBatch(ctx, root, session, jobs[index:end])
		failedID := ""
		var failure error
		for _, result := range results {
			if result.err != nil && failure == nil {
				failedID, failure = result.job.ID, result.err
			}
			if len(result.assets) > 0 {
				assets = append(assets, result.assets...)
				doc = setJobResult(doc, result.job.ID, result.job.ResultAssetID)
				setJobLanguage(&doc, result.job)
			}
		}
		if failure != nil {
			return doc, assets, failedID, failure
		}
		index = end
	}
	return doc, assets, "", nil
}

func materializeMediaBatch(ctx context.Context, root, session string, jobs []document.Job) []mediaJobResult {
	results := make([]mediaJobResult, len(jobs))
	var mu sync.Mutex
	next, failed := 0, false
	var workers sync.WaitGroup
	for range min(cap(mediaJobSlots), len(jobs)) {
		workers.Go(func() {
			for {
				mu.Lock()
				if failed || next == len(jobs) {
					mu.Unlock()
					return
				}
				index := next
				next++
				mu.Unlock()
				job := jobs[index]
				if job.ResultAssetID != "" {
					continue
				}
				result := generateIndependentMedia(ctx, root, session, job)
				mu.Lock()
				results[index] = result
				failed = failed || result.err != nil
				mu.Unlock()
			}
		})
	}
	workers.Wait()
	// Do not cancel in-flight paid siblings on failure: retain every successful
	// result in recovery, stop dispatching new work, and never retry providers.
	return results
}

func generateIndependentMedia(ctx context.Context, root, session string, job document.Job) mediaJobResult {
	select {
	case mediaJobSlots <- struct{}{}:
		defer func() { <-mediaJobSlots }()
	case <-ctx.Done():
		return mediaJobResult{job: job, err: ctx.Err()}
	}
	if err := ctx.Err(); err != nil {
		return mediaJobResult{job: job, err: err}
	}
	// Only immutable job input is shared. Result slices/documents are owned by
	// this worker and merged deterministically in recipe order after it finishes.
	doc := document.Document{Jobs: []document.Job{job}}
	doc, assets, err := materializeMediaJob(ctx, root, session, doc, nil, job)
	return mediaJobResult{job: doc.Jobs[0], assets: assets, err: err}
}

func setJobLanguage(doc *document.Document, result document.Job) {
	if result.Language == "" {
		return
	}
	for _, jobs := range [][]document.Job{doc.Before, doc.Jobs} {
		for index := range jobs {
			if jobs[index].ID == result.ID {
				jobs[index].Language = result.Language
			}
		}
	}
}
