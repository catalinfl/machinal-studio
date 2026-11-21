//go:build !linux

package sceneworker

import "context"

func workerReclaimer(manifestPath, cacheRoot string) func(context.Context) { return nil }
