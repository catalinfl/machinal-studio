//go:build !windows

package sessions

import (
	"fmt"
	"syscall"
)

func diskUsageFraction(path string) (float64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, fmt.Errorf("statfs %s: %w", path, err)
	}
	if stat.Blocks == 0 {
		return 0, nil
	}
	free := stat.Bavail
	if free > stat.Blocks {
		free = stat.Blocks
	}
	return 1 - float64(free)/float64(stat.Blocks), nil
}
