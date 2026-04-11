const defaultEmail = "founders@autoweave.dev";
const defaultDocsUrl = "#features";
const defaultGitHubUrl = "https://github.com";
const defaultSalesUrl = "#contact";

export const publicConfig = {
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || defaultEmail,
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL?.trim() || defaultDocsUrl,
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL?.trim() || defaultGitHubUrl,
  salesUrl: process.env.NEXT_PUBLIC_SALES_URL?.trim() || defaultSalesUrl,
};

export function toMailto(email: string) {
  return `mailto:${email}`;
}
