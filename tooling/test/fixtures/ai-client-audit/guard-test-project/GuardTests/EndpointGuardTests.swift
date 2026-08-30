import Testing

struct EndpointGuardTests {
    @Test func rejectsRemoteHosts() throws {
        let rejectedURLs = [
            "https://api.openai.com/v1",
            "https://api.anthropic.com/v1/chat/completions",
            "https://openrouter.ai/api/v1/chat/completions"
        ]
        for rejected in rejectedURLs {
            #expect(throws: GuardError.self) { try EndpointGuard.validatedLocalURL(from: rejected) }
        }
    }
}
