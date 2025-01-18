import requests
import gradio as gr

def send_chat_message(message, history):
    # API endpoint
    url = "http://localhost:8766/v1/chat/completions"
    
    # Convert history to messages format
    messages = [{"role": "system", "content": "You are a helpful assistant."}]
    for human, assistant in history:
        messages.append({"role": "user", "content": human})
        messages.append({"role": "assistant", "content": assistant})
    messages.append({"role": "user", "content": message})
    
    # Request payload
    payload = {
        "messages": messages,
        "model": "gpt-4o"
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

# Create Gradio interface
demo = gr.ChatInterface(
    fn=send_chat_message,
    title="ChatGPT API Chat",
    description="Chat with GPT-4 using local API endpoint",
    examples=["Tell me a story", "Explain quantum computing", "Write a poem about nature"],
    theme="soft"
)

if __name__ == "__main__":
    demo.launch(share=False)