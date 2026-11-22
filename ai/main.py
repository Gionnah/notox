from transformers import AutoImageProcessor, AutoModelForImageClassification
from PIL import Image
import torch

model_name = "king1oo1/deepfake-model" # Replace with your actual model ID
processor = AutoImageProcessor.from_pretrained(model_name)
model = AutoModelForImageClassification.from_pretrained(model_name)
model.eval()

image = Image.open("./ai.png").convert("RGB")
inputs = processor(images=image, return_tensors="pt")

with torch.no_grad():
    outputs = model(**inputs)
    probs = torch.softmax(outputs.logits, dim=1)
    fake_prob = probs[0][1].item() * 100
    real_prob = probs[0][0].item() * 100
    print(f"Fake probability: {fake_prob:.2f}%")
    print(f"Real probability: {real_prob:.2f}%")
    print(f"Verdict: {'FAKE' if fake_prob > 50 else 'REAL'}")