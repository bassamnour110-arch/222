# initial_login.py
import os
import time
import undetected_chromedriver as uc

# --- Settings ---
# Path to the master profile where the login will be stored
MASTER_PROFILE_PATH = os.path.join(os.getcwd(), "chatgpt_chrome_profile")
CHATGPT_URL = "https://chatgpt.com/"

def create_initial_profile():
    """
    Launches a Chrome browser with a dedicated user profile.
    The user needs to log in to ChatGPT manually. After logging in,
    the browser can be closed. The session data will be saved in the profile.
    """
    print("--- ChatGPT Initial Login Setup ---")

    if not os.path.exists(MASTER_PROFILE_PATH):
        print(f"🔹 Creating new profile directory at: {MASTER_PROFILE_PATH}")
        os.makedirs(MASTER_PROFILE_PATH)
    else:
        print(f"🔹 Using existing profile directory at: {MASTER_PROFILE_PATH}")

    options = uc.ChromeOptions()
    options.add_argument(f"--user-data-dir={MASTER_PROFILE_PATH}")
    options.add_argument('--start-maximized')
    options.add_argument("--disable-blink-features=AutomationControlled")

    driver = None
    try:
        print("🔹 Launching Chrome...")
        # Specify a version_main if you encounter issues
        driver = uc.Chrome(options=options)

        print(f"🔹 Navigating to: {CHATGPT_URL}")
        driver.get(CHATGPT_URL)

        print("\n" + "="*50)
        print("✨ ACTION REQUIRED ✨")
        print("Please log in to your ChatGPT account in the browser window.")
        print("Once you are successfully logged in, you can close this script by pressing Enter here.")
        print("="*50 + "\n")

        input("Press Enter to close the browser and save the session...")

    except Exception as e:
        print(f"❌ An error occurred: {e}")
    finally:
        if driver:
            print("🔹 Closing browser...")
            driver.quit()
        print("✅ Setup complete. Your login session is saved.")

if __name__ == "__main__":
    create_initial_profile()
