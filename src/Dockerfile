FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    REDLINE_BIND_HOST=0.0.0.0 \
    REDLINE_PORT=8000 \
    REDLINE_DATA_DIR=/app/data

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY --chown=10001:10001 main/resources/static/ /app/
RUN mkdir -p /app/data && chown 10001:10001 /app/data

USER 10001:10001
EXPOSE 8000
CMD ["python", "py/server.py"]
