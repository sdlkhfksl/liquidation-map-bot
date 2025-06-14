FROM public.ecr.aws/lambda/nodejs:18

# 安装 Chromium 运行时依赖
RUN yum -y install \
    atk cairo cups-libs dbus-glib GConf2 libXcomposite libXcursor libXdamage libXext libXi libXrandr \
    libXScrnSaver libXtst pango alsa-lib atk cups-libs gtk3 libX11 libXkbfile libsecret alsa-lib

WORKDIR /var/task
COPY package.json package-lock.json* ./
RUN npm install --production

COPY index.js ./

# 暴露给 Koyeb 健康检查器
EXPOSE 8080

# Koyeb 会执行 Procfile 中的 web: 命令
CMD ["index.handler"]
