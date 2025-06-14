FROM public.ecr.aws/lambda/nodejs:18

# 安装 Chromium 运行时依赖
RUN yum -y install \
    atk cairo cups-libs dbus-glib GConf2 libXcomposite libXcursor libXdamage libXext libXi libXrandr \
    libXScrnSaver libXtst pango alsa-lib atk cups-libs gtk3 libX11 libXkbfile libsecret alsa-lib

WORKDIR /var/task
COPY package.json package-lock.json* ./
RUN npm install --production

COPY index.js ./

CMD ["index.handler"] # 对应 AWS Lambda，但在 Koyeb 里会覆盖为 node index.js
