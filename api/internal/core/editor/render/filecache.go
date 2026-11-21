package render

import "ffmpeg-go-server/internal/platform/filecache"

func releaseRenderSources(scope fileScope, clips []clip) {
	seen := make(map[string]bool, len(clips))
	for _, moving := range clips {
		if seen[moving.File] {
			continue
		}
		seen[moving.File] = true
		if path, err := scope.join(moving.File); err == nil {
			filecache.ReleasePath(path)
		}
	}
}
