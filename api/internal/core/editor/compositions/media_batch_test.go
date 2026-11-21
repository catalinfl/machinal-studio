package compositions

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/imagegen"
)

func TestIndependentMediaRunsBoundedAndMergesInRecipeOrder(t *testing.T) {
	previous := generateImageCall
	t.Cleanup(func() { generateImageCall = previous })
	started, release := make(chan string, 4), make(chan struct{})
	var active, maximum atomic.Int32
	generateImageCall = func(ctx context.Context, _ string, join func(string) (string, error), prompt, _, _, _ string) (imagegen.GeneratedImage, error) {
		current := active.Add(1)
		defer active.Add(-1)
		for before := maximum.Load(); current > before && !maximum.CompareAndSwap(before, current); before = maximum.Load() {
		}
		started <- prompt
		select {
		case <-release:
		case <-ctx.Done():
			return imagegen.GeneratedImage{}, ctx.Err()
		}
		path, err := join(prompt + ".png")
		if err == nil {
			err = os.WriteFile(path, []byte(prompt), 0600)
		}
		return imagegen.GeneratedImage{Name: prompt + ".png", Width: 8, Height: 8}, err
	}
	doc := document.Document{Before: []document.Job{{ID: "a", Type: "image.generate", Prompt: "a"}, {ID: "b", Type: "image.generate", Prompt: "b"}, {ID: "c", Type: "image.generate", Prompt: "c"}}}
	done := make(chan struct{})
	var result document.Document
	var assets []document.Asset
	var failure error
	root := t.TempDir()
	go func() {
		result, assets, _, failure = materializeMediaJobs(context.Background(), root, "", doc, nil, doc.Before)
		close(done)
	}()
	for range 2 {
		select {
		case <-started:
		case <-time.After(5 * time.Second):
			close(release)
			t.Fatal("independent providers did not overlap")
		}
	}
	select {
	case <-started:
		t.Error("provider concurrency exceeded its global bound")
	default:
	}
	close(release)
	<-done
	if failure != nil || maximum.Load() != 2 || len(assets) != 3 {
		t.Fatal(failure, maximum.Load(), assets)
	}
	for index, job := range result.Before {
		if job.ResultAssetID != job.ID+".png" || assets[index].ID != job.ResultAssetID {
			t.Fatal("provider completion reordered recipe results", result.Before, assets)
		}
	}
}

func TestFailedParallelMediaRetainsSuccessfulSiblingWithoutReplay(t *testing.T) {
	previous := generateImageCall
	t.Cleanup(func() { generateImageCall = previous })
	siblingStarted := make(chan struct{})
	generateImageCall = func(_ context.Context, _ string, join func(string) (string, error), prompt, _, _, _ string) (imagegen.GeneratedImage, error) {
		if prompt == "fail" {
			<-siblingStarted
			return imagegen.GeneratedImage{}, errors.New("provider failed")
		}
		close(siblingStarted)
		path, err := join("success.png")
		if err == nil {
			err = os.WriteFile(path, []byte("retained"), 0600)
		}
		return imagegen.GeneratedImage{Name: "success.png", Width: 8, Height: 8}, err
	}
	doc := document.Document{Before: []document.Job{{ID: "failed", Type: "image.generate", Prompt: "fail"}, {ID: "success", Type: "image.generate", Prompt: "ok"}}}
	result, assets, failed, err := materializeMediaJobs(context.Background(), t.TempDir(), "", doc, nil, doc.Before)
	if err == nil || failed != "failed" || len(assets) != 1 || result.Before[1].ResultAssetID != "success.png" || result.Before[0].ResultAssetID != "" {
		t.Fatal("successful paid output was lost on sibling failure", result, assets, failed, err)
	}
}
