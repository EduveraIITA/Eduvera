FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    DEPLOYMENT_ENVIRONMENT=stage \
    CAMPUS_SIMULATOR_HOSTED=true \
    CAMPUS_SIMULATOR_ENABLED=true \
    CAMPUS_SIMULATOR_API_ORIGIN=https://app.thatcampus.com \
    PORT=8080
WORKDIR /app
RUN groupadd --system --gid 10001 campuslab \
    && useradd --system --uid 10001 --gid campuslab --home-dir /app campuslab
COPY --chown=campuslab:campuslab package.json ./
COPY --chown=campuslab:campuslab src ./src
COPY --chown=campuslab:campuslab fixtures ./fixtures
USER campuslab
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',{headers:{'x-campus-lab-key':process.env.CAMPUS_LAB_PROXY_KEY}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/index.mjs"]
