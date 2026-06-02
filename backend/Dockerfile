FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway provides PORT as environment variable
ENV PORT=8080

CMD ["python", "start.py"]
