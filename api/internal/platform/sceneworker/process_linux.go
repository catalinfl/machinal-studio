package sceneworker

import (
	"os/exec"
	"syscall"
	"time"
)

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
}

func stopProcess(cmd *exec.Cmd, done <-chan struct{}) {
	// Chromium and native renderers must not survive their Node parent.
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	timer := time.NewTimer(stopTimeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	<-done
}
