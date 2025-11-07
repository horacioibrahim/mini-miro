FROM nginx:alpine

# Copy static site
COPY . /usr/share/nginx/html/

# Replace default server config
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]

