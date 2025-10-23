# -*- coding: utf-8 -*-
import time
import os
import shutil
import pyperclip
import uuid
import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException, NoSuchElementException
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel
import uvicorn

# --- Settings ---
# Path to the master profile where the login is stored
MASTER_PROFILE_PATH = os.path.join(os.getcwd(), "chatgpt_chrome_profile")
CHATGPT_URL = "https://chatgpt.com/"

# --- Global Browser State Management ---
# This will now hold a dictionary: {'driver': driver_instance, 'session_path': path_to_session}
global_session = None

# --- Input Model for API Request ---
class PromptInput(BaseModel):
    prompt: str

# --- FastAPI App Initialization ---
app = FastAPI(
    title="ChatGPT Automation API",
    description="API to send prompts to ChatGPT and get back the text response.",
)

def cleanup_session_profile(session_path: str):
    """
    Helper function to remove a specific temporary session profile.
    Retries a few times in case of file lock issues.
    """
    if session_path and os.path.exists(session_path):
        print(f"🧹 Removing session profile '{session_path}'...")
        for i in range(3): # Retry up to 3 times
            try:
                shutil.rmtree(session_path)
                print("✔️ Session profile removed successfully.")
                return
            except OSError as e:
                print(f"⚠️ Attempt {i+1} failed to remove profile: {e}. Retrying in 1 second...")
                time.sleep(1)
        print(f"❌ Could not remove session profile directory after multiple attempts.")

def setup_driver():
    """
    Creates a new, UNIQUE temporary profile for each session, copies the master profile to it,
    and initializes the undetected_chromedriver.
    Returns a dictionary containing the driver instance and the unique session path.
    """
    if not os.path.exists(MASTER_PROFILE_PATH):
        raise Exception(f"Master profile not found at '{MASTER_PROFILE_PATH}'. Please run initial_login.py first.")

    # Generate a unique path for this session
    session_id = uuid.uuid4()
    session_profile_path = os.path.join(os.getcwd(), f"chatgpt_chrome_profile_session_{session_id}")
    print(f"🔹 Creating new unique session profile at: {session_profile_path}")

    # Patterns of files that often cause access errors and should be ignored
    ignore_patterns = shutil.ignore_patterns('*.lock', 'LOCK', '*.pma', 'Singleton*', 'Crashpad*')

    print("🔹 Copying master profile to the new session profile...")
    try:
        shutil.copytree(MASTER_PROFILE_PATH, session_profile_path, ignore=ignore_patterns)
        print("✔️ Profile copied successfully.")
    except Exception as e:
        print(f"❌ Critical error during profile copy: {e}")
        cleanup_session_profile(session_profile_path) # Attempt to clean up on failure
        raise e

    options = uc.ChromeOptions()
    options.add_argument(f"--user-data-dir={session_profile_path}")
    options.add_argument('--start-maximized')
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu') # Necessary for servers
    options.add_argument("--log-level=3")

    print("🔹 Initializing browser for this session...")
    driver = uc.Chrome(options=options)

    print("🔹 Waiting a few seconds for the browser to stabilize...")
    time.sleep(5)

    return {'driver': driver, 'session_path': session_profile_path}

def run_chatgpt_interaction(prompt: str):
    """
    Main function to handle the interaction with ChatGPT.
    Manages the global session state.
    """
    global global_session

    session_path_to_clean = None
    if global_session:
        session_path_to_clean = global_session.get('session_path')

    try:
        if not global_session:
            print("✨ No active session found. Initializing a new one.")
            global_session = setup_driver()
            print(f"🔹 Navigating to {CHATGPT_URL} to establish session...")
            global_session['driver'].get(CHATGPT_URL)
            WebDriverWait(global_session['driver'], 45).until(
                EC.presence_of_element_located((By.ID, 'prompt-textarea'))
            )
            print("✅ Browser is ready and session is established.")

        driver = global_session['driver']
        response_data = {"text_response": None}

        wait = WebDriverWait(driver, 30)
        long_wait = WebDriverWait(driver, 240)

        print(f"🔹 Sending prompt via clipboard: '{prompt[:100]}...'")
        pyperclip.copy(prompt)

        prompt_box = wait.until(EC.element_to_be_clickable((By.ID, 'prompt-textarea')))
        prompt_box.click()
        prompt_box.clear()

        actions = ActionChains(driver)
        actions.key_down(Keys.CONTROL).send_keys('v').key_up(Keys.CONTROL).perform()
        time.sleep(1)

        send_button = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[data-testid="send-button"]')))
        send_button.click()
        print("✔️ Prompt sent. Waiting for response...")

        stop_generating_button_selector = 'button[data-testid="stop-generating-button"]'
        print("🔹 Waiting for generation to complete...")
        long_wait.until(
            EC.invisibility_of_element_located((By.CSS_SELECTOR, stop_generating_button_selector))
        )
        print("✔️ Response received.")

        time.sleep(2)

        print("🔹 Extracting response text...")
        response_elements_xpath = "(//div[@data-message-author-role='assistant' and .//div[contains(@class, 'markdown')]])[last()]"
        response_element = driver.find_element(By.XPATH, response_elements_xpath)
        text_content = response_element.find_element(By.CSS_SELECTOR, ".markdown").get_attribute("textContent").strip()

        if text_content:
            response_data["text_response"] = text_content
            print(f"✔️ Text extracted successfully: {response_data['text_response'][:100]}...")
        else:
            print("⚠️ Text extraction resulted in an empty string.")

        return response_data

    except Exception as e:
        print(f"❌ An error occurred: {e}. The browser session will be terminated and cleaned up.")
        if global_session and global_session.get('driver'):
            global_session['driver'].quit()

        # Use the session path we captured at the start of the function
        if session_path_to_clean:
            cleanup_session_profile(session_path_to_clean)

        global_session = None # Reset global session state

        if isinstance(e, WebDriverException):
            raise HTTPException(status_code=503, detail="Browser session crashed. Please try again.")
        else:
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/send_prompt")
async def send_prompt_endpoint(input_data: PromptInput, response: Response):
    print(f"\n📨 New prompt received: '{input_data.prompt[:100]}...'")
    if not os.path.exists(MASTER_PROFILE_PATH):
        raise HTTPException(
            status_code=500,
            detail="Profile directory not found. Please run initial_login.py first to create the profile."
        )
    result = run_chatgpt_interaction(input_data.prompt)
    response.headers["Connection"] = "close"
    return {"status": "success", "data": result}

@app.post("/quit_browser")
async def quit_browser_endpoint():
    global global_session
    if global_session:
        print("🧹 Closing browser session via API call...")
        if global_session.get('driver'):
            global_session['driver'].quit()

        session_path = global_session.get('session_path')
        cleanup_session_profile(session_path)

        global_session = None
        return {"status": "success", "message": "Browser session closed and profile cleaned up."}
    return {"status": "info", "message": "No active browser session to close."}

if __name__ == "__main__":
    print("--- ChatGPT Automation API ---")
    print("Starting server... Access endpoints at http://localhost:8008")
    print("POST to /send_prompt with JSON body: {\"prompt\": \"your message\"}")
    print("POST to /quit_browser to close the session.")

    if not os.path.exists(MASTER_PROFILE_PATH):
        print("\n⚠️ WARNING: Chrome master profile directory not found.")
        print("Please run initial_login.py once manually to log in and create the 'chatgpt_chrome_profile' directory.")

    uvicorn.run(app, host="0.0.0.0", port=8008)
