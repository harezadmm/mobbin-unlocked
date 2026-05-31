sips -s format png mobbin-unlocked.png --out temp.png

for size in 16 24 32 48 128; do
  sips -z $size $size temp.png --out icon-$size.png
done

rm temp.png