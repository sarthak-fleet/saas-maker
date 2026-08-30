enum EndpointGuard {
    static let defaultLocalBaseURL = "http://127.0.0.1:1234/v1"

    static func validatedLocalURL(from raw: String) throws -> URL {
        guard let url = URL(string: raw), url.host == "127.0.0.1" else { throw GuardError.remote }
        return url
    }
}
