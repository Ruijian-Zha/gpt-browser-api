import requests
import base64
from PIL import Image
import io

def encode_image_to_base64(image_path):
    with Image.open(image_path) as image:
        if image.mode == 'RGBA':
            image = image.convert('RGB')
        buffered = io.BytesIO()
        image.save(buffered, format="JPEG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        return f"data:image/jpeg;base64,{img_str}"

def describe_image(image_path):
    # API endpoint
    url = "http://localhost:8766/v1/chat/completions"
    
    # Encode image
    base64_image = encode_image_to_base64(image_path)
    
    # Create message with image
    messages = [
        {"role": "system", "content": "You are a helpful assistant."},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Please describe this image in detail."},
                {"type": "image_url", "image_url": {"url": base64_image}}
            ]
        }
    ]
    
    # Request payload
    payload = {
        "messages": messages,
        "model": "gpt-4-vision-preview",
        "max_tokens": 4096
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
    image_path = "/Users/zhar2/Documents/Github/gpt-browser-api/success.png"
    description = describe_image(image_path)
    print("\nImage Description:")
    print(description)