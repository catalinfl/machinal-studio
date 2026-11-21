package compositions

import (
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/render/textprepare"
	"ffmpeg-go-server/internal/core/editor/imagegen"
	"ffmpeg-go-server/internal/core/editor/speech"
	"os"
	"strings"
)

func generationCapabilities() map[string]any {
	providerConfigured := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")) != ""
	transcriptionModel := strings.TrimSpace(os.Getenv("OPENROUTER_STT_MODEL"))
	sceneModel := strings.TrimSpace(os.Getenv("OPENROUTER_SCENE_MODEL")) != "" || strings.TrimSpace(os.Getenv("OPENROUTER_MODEL")) != ""
	return map[string]any{
		"image":            map[string]any{"supported": true, "configured": providerConfigured, "configurationOnly": true, "maxConcurrentRequests": imagegen.ConcurrencyLimit()},
		"mediaConcurrency": map[string]any{"maxIndependentJobs": cap(mediaJobSlots), "scope": "server-process", "configuration": "MACHINAL_MEDIA_CONCURRENCY", "automaticReplay": false},
		"speech": map[string]any{
			"supported": true, "configured": providerConfigured, "configurationOnly": true,
			"languageField": "language", "autoDetect": []string{"ro", "en"},
			"romanianDefaultModel": speech.GeminiFlashModel, "deliveryInstructions": true,
			"catalogTool": "list_speech_models", "modelTool": "get_speech_model",
			"catalogVersion":              speech.CatalogVersion(),
			"selectionRequiresUserChoice": true, "automaticModelFallback": false,
			"recommendations": map[string][]string{"ro": {speech.GeminiFlashModel, speech.GeminiLiteModel}, "en": {speech.KokoroModel, speech.GeminiLiteModel, speech.GeminiFlashModel}},
		},
		"music":        map[string]any{"supported": false, "configured": false, "reason": "Existing music can be mixed, but this API has no music-generation action"},
		"soundLibrary": map[string]any{"supported": true, "configurationOnly": true, "provider": "openverse", "searchTool": "search_sound_effects", "importTool": "import_sound_effect", "licenses": []string{"cc0", "by"}, "defaultLicense": "cc0", "importHosts": []string{"cdn.freesound.org"}, "maxBytes": 8 << 20, "sourceVersionRequired": true, "attributionPersisted": true, "audioVerified": false, "generation": false},
		"scene": map[string]any{
			"configured": providerConfigured && sceneModel && strings.TrimSpace(os.Getenv("SCENE_SERVICE_URL")) != "", "configurationOnly": true,
			"visualModes": []string{"auto", "2d", "3d"}, "threeJS": true,
			"maxPromptCharacters": document.MaxScenePromptRunes, "maxImages": document.MaxSceneImages,
			"generatedImageDependencies": true,
			"narrationBinding":           true, "layoutInspection": true, "captionSafeBottom": 0.24,
			"fonts": []string{"Direction Sans", "Direction Serif", "Direction Mono", "Montserrat", "Open Sans", "Oswald", "Playfair Display", "IBM Plex Sans", "Lato"},
		},
		"clientScene": map[string]any{
			"supported": true, "configured": strings.TrimSpace(os.Getenv("SCENE_SERVICE_URL")) != "", "configurationOnly": true,
			"author": "current-client-ai", "compileTool": "compile_scene", "sourceTool": "get_scene_source",
			"providerRequired": false, "codeGenerationCredits": 0, "compilationCredits": 0, "automaticProviderFallback": false,
			"serverRenderingBilled": false, "renderPricingSource": "user-owned-local-hardware",
			"maxComponentBytes": 64000, "maxDurationSeconds": 60, "maxDimension": 1920,
			"visualModes": []string{"auto", "2d", "3d"}, "layoutInspection": true,
			"parameterTool": "edit_scene_parameters", "maxParameterObjects": 32, "versionedParameterEdits": true,
			"models": map[string]any{"supported": true, "format": "glb-v2", "maxAttachments": 2, "maxBytesEach": 4 << 20,
				"selfContainedOnly": true, "maxScenes": 1, "embeddedTextureMimeTypes": []string{"image/png"}, "maxTexturePixelsEach": 4_000_000,
				"maxTexturePixelsTotal": 8_000_000, "externalURIs": false, "extensions": false, "importedAnimations": false,
				"skins": false, "morphTargets": false, "trianglePrimitivesOnly": true, "maxExpandedPrimitives": 256, "maxExpandedVertices": 500_000},
			"textureHelper": "loadSceneTexture", "asyncThreeSetup": true,
			"handoffTool": "handoff_scene", "registeredStateRequired": true, "handoffDiagnosticCredits": 0,
			"handoffCoordinateConversion": false, "automaticTimelineReplacement": false,
			"anchoredLabelHelper": "placeAnchoredLabel", "automaticCaptionLayout": false,
			"animationSkillsTopic": "animation-skills", "reviewPlanTool": "plan_scene_review",
		},
		"sceneInspection": map[string]any{
			"supported": true, "configured": strings.TrimSpace(os.Getenv("SCENE_SERVICE_URL")) != "", "configurationOnly": true,
			"tool": "inspect_scene", "maxFrames": 6, "maxThumbnailEdge": 480,
			"sourceVersionRequired": true, "sourceApprovalRequired": true, "diagnosticCredits": 0,
			"registeredSemanticStates":   true,
			"finalCompositionInspection": false, "motionVerified": false, "audioVerified": false,
		},
		"compositionPreview": map[string]any{
			"supported": true, "tool": "render_preview", "maxDurationSeconds": 15,
			"resolvedAssetsOnly": true, "format": "mp4", "includesMixedAudio": true,
			"billingBasis": "none-local-hardware", "processingBasis": "preview-work-window-including-temporal-dependencies", "fullReferencedSceneRenderingBilled": false,
			"sceneFrameRanges": true, "unrelatedSourcesSkipped": true,
			"excerptAtFinalEncoding": true, "automaticReviewLoop": false,
		},
		"captions": map[string]any{
			"defaultMaxWords": 4, "maxWords": 50, "autoFit": true, "maxLines": 2,
			"configured": providerConfigured && transcriptionModel != "", "configurationOnly": true,
			"model": transcriptionModel, "provider": strings.TrimSpace(os.Getenv("OPENROUTER_STT_PROVIDER")),
			"responseFormat": "verbose_json", "requestedTimestampGranularities": []string{"word", "segment"},
		},
		"textPreparation": map[string]any{
			"configured":        textprepare.Configured(),
			"configurationOnly": true,
		},
	}
}
