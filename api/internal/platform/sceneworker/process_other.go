//go:build !linux && !windows

package sceneworker

import "os/exec"

func configureProcess(cmd *exec.Cmd) {}

func stopProcess(cmd *exec.Cmd, done <-chan struct{}) {
	_ = cmd.Process.Kill()
	<-done
}
