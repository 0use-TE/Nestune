FROM mwader/static-ffmpeg:7.1@sha256:a8090df5f5608daef387e1b2e93b98aaacb4d92153ad904e7d715c725724fca4 AS ffmpeg
FROM node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d AS cpp-runtime
FROM python:3.13-slim-trixie@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90 AS base
COPY --from=ffmpeg /ffmpeg /ffprobe /usr/local/bin/
COPY --from=ffmpeg /doc /usr/share/doc/static-ffmpeg
COPY --from=ffmpeg /versions.json /usr/share/doc/static-ffmpeg/versions.json
COPY --from=cpp-runtime /usr/lib/x86_64-linux-gnu/libstdc++.so.6* /usr/lib/x86_64-linux-gnu/
COPY --from=cpp-runtime /usr/lib/x86_64-linux-gnu/libgcc_s.so.1 /usr/lib/x86_64-linux-gnu/
COPY --from=cpp-runtime /usr/lib/x86_64-linux-gnu/libz.so.1* /usr/lib/x86_64-linux-gnu/
COPY vendor/ncmdump /usr/local/bin/ncmdump
COPY vendor/ncmdump-LICENSE.txt /usr/share/licenses/ncmdump/LICENSE
RUN echo "1fb62a06487c1c2a4bcc4bdf61bd9191e6dd83dfd61cd3425b56a4379f916eea  /usr/local/bin/ncmdump" | sha256sum -c - && chmod 755 /usr/local/bin/ncmdump && ncmdump -v
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY worker.py cli.py ./

FROM base AS test
COPY test ./test
RUN python -m unittest discover -s test -v

FROM test AS runtime
RUN groupadd -g 1000 nestune && useradd -u 1000 -g 1000 -M nestune && mkdir -p /state /output /input && chown 1000:1000 /state /output
USER 1000:1000
EXPOSE 4191
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4191/health',timeout=3)"
CMD ["python", "worker.py"]
