//go:build !linux

package filecache

import "os"

func release(*os.File) error { return nil }

func releasePath(string) error { return nil }
