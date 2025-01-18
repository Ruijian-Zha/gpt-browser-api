import requests

def say_hello():
    # API endpoint
    url = "http://localhost:8766/v1/chat/completions"
    
    # Create simple message
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Say hello world"}
    ]
    
    # Request payload
    payload = {
        "messages": messages,
        "model": "gpt-4",
        "max_tokens": 50
    }

    try:
        # Send POST request
        response = requests.post(url, json=payload)
        response.raise_for_status()
        
        # Parse response
        result = response.json()
        return result["choices"][0]["message"]["content"]
        
    except requests.exceptions.RequestException as e:
        return f"Error making request: {e}"

if __name__ == "__main__":
    response = say_hello()
    print("\nResponse:")
    print(response)
