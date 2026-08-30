pub async fn fetch_spend(admin_key: &str) -> Result<Spend, Error> {
    let client = reqwest::Client::new();
    let url = "https://api.anthropic.com/v1/organizations/me/usage_report";
    let anthropic = client.get(url).header("x-api-key", admin_key).send().await?;

    let openai_url = "https://api.openai.com/v1/organization/costs";
    let openai = client.get(openai_url).bearer_auth(admin_key).send().await?;
    Ok(Spend::merge(anthropic, openai))
}
