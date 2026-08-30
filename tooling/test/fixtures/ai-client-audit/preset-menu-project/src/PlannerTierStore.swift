enum DirectAPIProvider {
    case anthropic, openai, openrouter, custom

    var defaultEndpointURLString: String {
        switch self {
        case .anthropic:  return "https://api.anthropic.com/v1/chat/completions"
        case .openai:     return "https://api.openai.com/v1/chat/completions"
        case .openrouter: return "https://openrouter.ai/api/v1/chat/completions"
        case .custom:     return ""
        }
    }
}
