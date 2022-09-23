# Pixiv to Gelbooru upload helper

This is a Chrome extension which enhances the website [Pixiv](https://www.pixiv.net/) to facilitate uploading pictures from there to Gelbooru.

## Usage

The Chrome extension [Improved Gelbooru upload](https://github.com/Phxstick/improved-gelbooru-upload) needs to be installed and active. Whenever the upload status of a Pixiv artwork is checked via that extension, it will be remembered by this extension and reflected on Pixiv. If an artwork has been uploaded to Gelbooru already, its thumbnails will be highlighted with a blue glowing border. If it's not uploaded yet, the thumbnails get a red glowing border. 

You can use the following shortcuts to quickly conduct status checks and prepare uploads:

- **Ctrl + click** an artwork to download the original sized version and send it to the Gelbooru upload extension, which checks whether it has already been posted on Gelbooru.
- **Ctrl + Alt + click** the name of an artist to search Gelbooru for all posts by this artist which have a Pixiv link as their source. All corresponding Pixiv artworks will be marked as uploaded.
- **Ctrl + Alt + click** the thumbnail of a checked Pixiv artwork to view a list of links to the corresponding Gelbooru posts (you can also manually associate an existing Gelbooru post from here).