# SDLC Dashboard

Live site: **https://vigneshwaran-kr-6055.github.io/Test-Cases/**

## How to publish this repo (GitHub Pages)

The site deploys automatically via GitHub Actions whenever code is pushed to `main`.
All the required files are already in place:

| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | Deploys to GitHub Pages on every push to `main` |
| `.nojekyll` | Tells GitHub Pages to serve files as-is (no Jekyll processing) |

### Step-by-step: merge the open PR and go live

1. Open **[Pull Request #2](https://github.com/vigneshwaran-kr-6055/Test-Cases/pull/2)** in your browser.
2. Click **"Ready for review"** (it is currently a draft).
3. Click **"Merge pull request"** → **"Confirm merge"**.
4. GitHub Actions will automatically run the **Deploy to GitHub Pages** workflow.
5. After ~1 minute the site will be live at:
   - **https://vigneshwaran-kr-6055.github.io/Test-Cases/** (dashboard)
   - **https://vigneshwaran-kr-6055.github.io/Test-Cases/test-case-analyzer.html** (analyser tool)

### Alternative: trigger the deployment manually (without merging)

1. Go to **[Actions → Deploy to GitHub Pages](https://github.com/vigneshwaran-kr-6055/Test-Cases/actions/workflows/deploy.yml)**.
2. Click **"Run workflow"**.
3. Select branch **`copilot/fix-published-link-error`** from the dropdown.
4. Click **"Run workflow"** — the site will deploy within ~1 minute.

## Local development

Clone the repo and open `index.html` directly in your browser — no build step needed.

```bash
git clone https://github.com/vigneshwaran-kr-6055/Test-Cases.git
cd Test-Cases
open index.html   # macOS
# or: start index.html  (Windows)
# or: xdg-open index.html  (Linux)
```

## API Integration Guide
* To integrate the API, follow these steps:
    1. **Authentication:**
        - Use the API Key provided in the `.env` file for authentication in all requests.
    2. **Endpoints:**
        - **GET /api/dashboard/data**: Retrieve dashboard data.
        - **POST /api/dashboard/update**: Update dashboard information.
        - **DELETE /api/dashboard/{id}**: Delete dashboard entry by ID.
    3. **Example Request:**  
        ```javascript
        fetch('/api/dashboard/data', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.API_KEY}`
            }
        })
        .then(response => response.json())
        .then(data => console.log(data));
        ```

## Security Best Practices
- **Keep Dependencies Updated:**
  Regularly check for updates and vulnerabilities in dependencies.
- **Environment Variables:**
  Never hard-code sensitive information like API keys, passwords, etc. Always use environment variables.
- **Authentication:**
  Use robust authentication mechanisms and ensure that API keys are kept secure.
- **Input Validation:**
  Always validate user inputs to prevent SQL injection and other attacks.
- **Regular Security Audits:**
  Schedule regular audits of your codebase for security vulnerabilities.

## Conclusion
Following these instructions will help you set up the SDLC Dashboard smoothly and integrate it with best security practices in mind.