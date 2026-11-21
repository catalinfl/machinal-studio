package mcpserver

import (
	"errors"

	"ffmpeg-go-server/editengine/document"
)

type contractValidationError struct {
	diagnostic document.Diagnostic
}

func (err *contractValidationError) Error() string {
	return err.diagnostic.Path + ": " + err.diagnostic.Message
}

func invalidContractField(path, code, message string) error {
	return &contractValidationError{document.Diagnostic{Severity: "error", Path: path, Code: code, Message: message}}
}

func contractFieldError(prefix string, err error) error {
	var field *contractValidationError
	if !errors.As(err, &field) {
		return invalidContractField(prefix, "invalid_production_contract", err.Error())
	}
	diagnostic := field.diagnostic
	diagnostic.Path = prefix + "." + diagnostic.Path
	return &contractValidationError{diagnostic}
}
