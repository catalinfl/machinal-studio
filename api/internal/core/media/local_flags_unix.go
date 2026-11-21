//go:build !windows

package media

import "syscall"

// A file swapped for a FIFO must not block a request before descriptor validation.
const localReadFlags = syscall.O_RDONLY | syscall.O_NONBLOCK
