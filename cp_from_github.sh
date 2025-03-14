echo "copy from github to local"
rsync -arp --exclude '.git' --exclude '.github' --exclude '.gitignore' --exclude '.gitmodules' '../bmMediasoupServer/' '.'
